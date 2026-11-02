-- Aplicar no banco existente que já possui a vigência de 30 dias.
-- Aceita os nomes antigos ou os cinco nomes confirmados; preserva pagamentos.
BEGIN;
ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS componentes_incluidos text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS codigo text;

UPDATE public.planos
SET codigo=CASE regexp_replace(lower(btrim(nome)),'[^[:alnum:]]','','g')
  WHEN 'essencial' THEN 'cabelo'
  WHEN 'cabelo' THEN 'cabelo'
  WHEN 'corte' THEN 'cabelo'
  WHEN 'clássico' THEN 'cabelo_sobrancelha'
  WHEN 'classico' THEN 'cabelo_sobrancelha'
  WHEN 'cabeloesobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'cabelosobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'corteesobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'cortesobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'cabeloebarba' THEN 'cabelo_barba'
  WHEN 'cabelobarba' THEN 'cabelo_barba'
  WHEN 'corteebarba' THEN 'cabelo_barba'
  WHEN 'cortebarba' THEN 'cabelo_barba'
  WHEN 'premium' THEN 'completo'
  WHEN 'completo' THEN 'completo'
  WHEN 'cabelobarbaesobrancelha' THEN 'completo'
  WHEN 'cabeloebarbaesobrancelha' THEN 'completo'
  WHEN 'cabelobarbasobrancelha' THEN 'completo'
  WHEN 'cortebarbaesobrancelha' THEN 'completo'
  WHEN 'cortebarbasobrancelha' THEN 'completo'
  WHEN 'barba' THEN 'barba'
  ELSE NULL END
WHERE codigo IS NULL;


UPDATE public.planos SET componentes_incluidos=CASE codigo
  WHEN 'cabelo' THEN ARRAY['corte']
  WHEN 'cabelo_barba' THEN ARRAY['corte','barba']
  WHEN 'cabelo_sobrancelha' THEN ARRAY['corte','sobrancelha']
  WHEN 'completo' THEN ARRAY['corte','barba','sobrancelha']
  WHEN 'barba' THEN ARRAY['barba']
  ELSE componentes_incluidos END
WHERE codigo IN ('cabelo','cabelo_barba','cabelo_sobrancelha','completo','barba');


-- Origem: 20261102000000_pontos_por_cobertura.sql
-- Nova regra: apenas componentes realizados e cobertos pelo plano pontuam.
-- Essencial: corte. Clássico: corte e barba. Premium: corte, barba e sobrancelha.
-- Sobrancelha avulsa: R$ 10. Não altera atendimentos já concluídos.

ALTER TABLE public.planos
  ADD COLUMN IF NOT EXISTS componentes_incluidos text[] NOT NULL DEFAULT '{}';

UPDATE public.planos
SET componentes_incluidos = CASE lower(btrim(nome))
  WHEN 'essencial' THEN ARRAY['corte']
  WHEN 'clássico' THEN ARRAY['corte','barba']
  WHEN 'classico' THEN ARRAY['corte','barba']
  WHEN 'premium' THEN ARRAY['corte','barba','sobrancelha']
  ELSE componentes_incluidos
END;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.planos WHERE ativo AND cardinality(componentes_incluidos)=0) THEN
    RAISE EXCEPTION 'Há um plano ativo sem cobertura configurada. Revise o cadastro antes de aplicar.';
  END IF;
  IF (SELECT count(*) FROM public.servicos WHERE lower(btrim(nome))='sobrancelha') > 1 THEN
    RAISE EXCEPTION 'Há serviços Sobrancelha duplicados. Revise o cadastro.';
  END IF;
END;
$guard$;

ALTER TABLE public.planos DROP CONSTRAINT IF EXISTS planos_componentes_validos;
ALTER TABLE public.planos ADD CONSTRAINT planos_componentes_validos CHECK (
  componentes_incluidos <@ ARRAY['corte','barba','sobrancelha']::text[]
  AND array_position(componentes_incluidos,NULL) IS NULL
  AND coalesce(array_ndims(componentes_incluidos),1)=1
);

CREATE OR REPLACE FUNCTION public.validar_cobertura_plano()
RETURNS trigger LANGUAGE plpgsql SET search_path TO public
AS $function$
BEGIN
  IF cardinality(NEW.componentes_incluidos)=0 THEN
    NEW.componentes_incluidos := CASE lower(btrim(NEW.nome))
      WHEN 'essencial' THEN ARRAY['corte']
      WHEN 'clássico' THEN ARRAY['corte','barba']
      WHEN 'classico' THEN ARRAY['corte','barba']
      WHEN 'premium' THEN ARRAY['corte','barba','sobrancelha']
      ELSE NEW.componentes_incluidos END;
  END IF;
  IF NEW.ativo AND cardinality(NEW.componentes_incluidos)=0 THEN
    RAISE EXCEPTION 'Configure os serviços incluídos antes de ativar o plano.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.validar_cobertura_plano() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_validar_cobertura_plano ON public.planos;
CREATE TRIGGER trg_validar_cobertura_plano
BEFORE INSERT OR UPDATE OF nome,ativo,componentes_incluidos ON public.planos
FOR EACH ROW EXECUTE FUNCTION public.validar_cobertura_plano();

CREATE OR REPLACE FUNCTION public.componentes_do_servico(p_nome text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO public
AS $function$
  SELECT coalesce(array_agg(DISTINCT parte ORDER BY parte),'{}'::text[])
  FROM regexp_split_to_table(lower(btrim(coalesce(p_nome,''))), '\s*\+\s*') AS partes(parte)
  WHERE parte IN ('corte','barba','sobrancelha','pezinho');
$function$;

CREATE OR REPLACE FUNCTION public.pontos_dos_componentes(p_componentes text[])
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO public
AS $function$
  SELECT coalesce(sum(CASE codigo
    WHEN 'corte' THEN 40 WHEN 'barba' THEN 20
    WHEN 'sobrancelha' THEN 10 WHEN 'pezinho' THEN 10 ELSE 0 END),0)::integer
  FROM (SELECT DISTINCT unnest(p_componentes) AS codigo) AS itens;
$function$;

CREATE OR REPLACE FUNCTION public.pontos_cobertos_do_servico(
  p_servico_id bigint, p_plano_id bigint, p_adicionais text[] DEFAULT '{}'
)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public
AS $function$
  SELECT public.pontos_dos_componentes(ARRAY(
    SELECT DISTINCT item.codigo
    FROM public.servicos AS s
    JOIN public.planos AS pl ON pl.id=p_plano_id
    CROSS JOIN LATERAL unnest(public.componentes_do_servico(s.nome) || coalesce(p_adicionais,'{}')) AS item(codigo)
    WHERE s.id=p_servico_id AND item.codigo=ANY(pl.componentes_incluidos)
  ));
$function$;

CREATE OR REPLACE FUNCTION public.preco_do_adicional(p_codigo text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public
AS $function$
  SELECT s.preco FROM public.servicos AS s
  WHERE s.ativo AND lower(btrim(s.nome))=p_codigo
  ORDER BY s.id LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.desconto_coberto_do_servico(p_servico_id bigint,p_plano_id bigint)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public
AS $function$
  SELECT least(s.preco,coalesce((
    SELECT sum(public.preco_do_adicional(item.codigo))
    FROM unnest(public.componentes_do_servico(s.nome)) AS item(codigo)
    WHERE item.codigo=ANY(pl.componentes_incluidos)
  ),0))
  FROM public.servicos AS s CROSS JOIN public.planos AS pl
  WHERE s.id=p_servico_id AND pl.id=p_plano_id;
$function$;

REVOKE ALL ON FUNCTION public.componentes_do_servico(text),
  public.pontos_dos_componentes(text[]),
  public.pontos_cobertos_do_servico(bigint,bigint,text[]),
  public.preco_do_adicional(text),
  public.desconto_coberto_do_servico(bigint,bigint)
FROM PUBLIC,anon,authenticated,service_role;

UPDATE public.servicos SET preco=10 WHERE lower(btrim(nome))='sobrancelha';

-- Este combo estava em zero por ter sido cadastrado como opção de plano.
UPDATE public.servicos SET preco=40
WHERE regexp_replace(lower(nome),'\s+','','g')='corte+sobrancelha' AND preco=0;

UPDATE public.servicos
SET pontos=public.pontos_dos_componentes(public.componentes_do_servico(nome))
WHERE cardinality(public.componentes_do_servico(nome))>0;

-- Sincroniza o desconto com os componentes incluídos. Não muda mensalidades.
DELETE FROM public.plano_servicos AS ps
USING public.planos AS pl, public.servicos AS s
WHERE ps.plano_id=pl.id AND ps.servico_id=s.id
  AND lower(btrim(pl.nome)) IN ('essencial','clássico','classico','premium')
  AND cardinality(public.componentes_do_servico(s.nome))>0
  AND NOT (public.componentes_do_servico(s.nome) && pl.componentes_incluidos);

INSERT INTO public.plano_servicos(plano_id,servico_id,valor_desconto)
SELECT pl.id,s.id,least(s.preco,desconto.valor)
FROM public.planos AS pl
CROSS JOIN public.servicos AS s
CROSS JOIN LATERAL (
  SELECT coalesce(sum(public.preco_do_adicional(item.codigo)),0) AS valor
  FROM unnest(public.componentes_do_servico(s.nome)) AS item(codigo)
  WHERE item.codigo=ANY(pl.componentes_incluidos)
) AS desconto
WHERE lower(btrim(pl.nome)) IN ('essencial','clássico','classico','premium')
  AND public.componentes_do_servico(s.nome) && pl.componentes_incluidos
ON CONFLICT(plano_id,servico_id) DO UPDATE SET valor_desconto=excluded.valor_desconto;

UPDATE public.planos SET descricao=CASE lower(btrim(nome))
  WHEN 'essencial' THEN 'Cabelo ilimitado'
  WHEN 'clássico' THEN 'Cabelo e barba ilimitados'
  WHEN 'classico' THEN 'Cabelo e barba ilimitados'
  WHEN 'premium' THEN 'Cabelo, barba e sobrancelha ilimitados'
  ELSE descricao END;

CREATE OR REPLACE FUNCTION public.criar_agendamento(p_nome_cliente text, p_telefone text, p_barbeiro_id bigint, p_servico_id bigint, p_data date, p_horario_inicio time without time zone, p_categoria text)
 RETURNS TABLE(id bigint, horario_final time without time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_duracao integer;
  v_preco numeric;
  v_preco_cobrado numeric;
  v_valor_desconto numeric := 0;
  v_pontos integer;
  v_horario_fim time;
  v_agendamento_id bigint;

  v_assinatura_id bigint;
  v_plano_id bigint;

  v_agora timestamp :=
    timezone('America/Sao_Paulo', now());
begin
  if btrim(coalesce(p_nome_cliente, '')) = '' then
    raise exception 'Informe o nome do cliente.';
  end if;

  if btrim(coalesce(p_telefone, '')) = '' then
    raise exception 'Informe o telefone do cliente.';
  end if;

  if p_data is null or p_horario_inicio is null then
    raise exception 'Informe a data e o horário.';
  end if;

  if p_categoria is null or p_categoria not in ('avulso', 'plano') then
    raise exception 'Categoria inválida.';
  end if;

  perform 1
  from public.barbeiros as b
  where b.id = p_barbeiro_id
    and b.ativo = true
  for update;

  if not found then
    raise exception 'Barbeiro inválido ou inativo.';
  end if;

  select
    s.duracao_minutos,
    s.preco,
    s.pontos
  into
    v_duracao,
    v_preco,
    v_pontos
  from public.servicos as s
  where s.id = p_servico_id
    and s.ativo = true
    and s.agendavel_online = true;

  if not found then
    raise exception 'Serviço inválido ou indisponível.';
  end if;

  if v_duracao is null or v_duracao <= 0 then
    raise exception 'O serviço possui uma duração inválida.';
  end if;

  if v_preco is null or v_pontos is null then
    raise exception 'O serviço possui dados incompletos.';
  end if;

  if p_categoria = 'plano' then
    select
      a.id,
      a.plano_id
    into
      v_assinatura_id,
      v_plano_id
    from public.clientes as c
    join public.assinaturas as a
      on a.cliente_id = c.id
    join public.planos as p
      on p.id = a.plano_id
    where public.normalizar_telefone_br(c.telefone) =
          public.normalizar_telefone_br(p_telefone)
      and c.ativo = true
      and p.ativo = true
      and a.status = 'ativa'
      and p_data between a.data_inicio and a.data_fim
    order by a.data_fim desc, a.id desc
    limit 1;

    if not found then
      raise exception 'Nenhum plano ativo foi encontrado para este telefone.';
    end if;

    if not exists (
      select 1
      from public.pagamentos_planos as pp
      where pp.assinatura_id = v_assinatura_id
        and pp.status = 'pago'
        and p_data between pp.vigencia_inicio and pp.vigencia_fim
        and pp.data_pagamento <= now()
    ) then
      raise exception 'O pagamento do plano não cobre a data deste agendamento.';
    end if;

    v_valor_desconto := coalesce(
      public.desconto_coberto_do_servico(p_servico_id,v_plano_id),0
    );

    v_preco_cobrado :=
      greatest(v_preco - v_valor_desconto, 0);

    v_pontos := public.pontos_cobertos_do_servico(p_servico_id, v_plano_id, '{}'::text[]);
  else
    v_preco_cobrado := v_preco;
    v_pontos := 0;
  end if;

  if p_data < v_agora::date
    or (
      p_data = v_agora::date
      and p_horario_inicio <= v_agora::time
    )
  then
    raise exception 'Não é possível agendar um horário que já passou.';
  end if;

  v_horario_fim :=
    p_horario_inicio + make_interval(mins => v_duracao);

  if v_horario_fim <= p_horario_inicio then
    raise exception 'O atendimento não pode terminar no dia seguinte.';
  end if;

  if exists (
    select 1
    from public.agendamentos as a
    where a.barbeiro_id = p_barbeiro_id
      and a.data = p_data
      and a.status <> 'cancelado'
      and p_horario_inicio < a.horario_fim
      and v_horario_fim > a.horario_inicio
  ) then
    raise exception 'Este horário está indisponível.';
  end if;

  insert into public.agendamentos as a (
    nome_cliente,
    telefone,
    barbeiro_id,
    servico_id,
    assinatura_id,
    data,
    horario_inicio,
    horario_fim,
    duracao_minutos,
    preco_cobrado,
    pontos_gerados,
    categoria,
    status
  )
  values (
    btrim(p_nome_cliente),
    btrim(p_telefone),
    p_barbeiro_id,
    p_servico_id,
    v_assinatura_id,
    p_data,
    p_horario_inicio,
    v_horario_fim,
    v_duracao,
    v_preco_cobrado,
    v_pontos,
    p_categoria,
    'agendado'
  )
  returning a.id
  into v_agendamento_id;

  return query
  select v_agendamento_id, v_horario_fim;
end;
$function$;

CREATE OR REPLACE FUNCTION public.concluir_agendamento_com_adicionais(
  p_agendamento_id bigint,
  p_adicionais text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo text;
  v_barbeiro_id bigint;
  v_agendamento public.agendamentos%ROWTYPE;
  v_adicionais text[] := coalesce(p_adicionais, '{}'::text[]);
  v_incluidos text[];
  v_adicional text;
  v_plano_id bigint;
  v_cobertos text[] := '{}'::text[];
  v_preco_extra numeric;
  v_total_extras numeric := 0;
  v_pontos_final integer;
  v_assinatura_id bigint;
  v_hoje date := timezone('America/Sao_Paulo', now())::date;
BEGIN
  SELECT p.tipo, p.barbeiro_id
  INTO v_tipo, v_barbeiro_id
  FROM public.perfis AS p
  WHERE p.usuario_id = auth.uid()
    AND p.ativo = true
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não autorizado.';
  END IF;

  SELECT a.*
  INTO v_agendamento
  FROM public.agendamentos AS a
  WHERE a.id = p_agendamento_id
    AND a.status = 'agendado'
    AND (v_tipo = 'admin' OR a.barbeiro_id = v_barbeiro_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Agendamento não encontrado, já finalizado ou pertence a outro barbeiro.';
  END IF;

  IF coalesce(array_ndims(v_adicionais), 1) > 1
     OR cardinality(v_adicionais) > 3
     OR EXISTS (
       SELECT 1
       FROM unnest(v_adicionais) AS extra(codigo)
       WHERE extra.codigo IS NULL
         OR extra.codigo NOT IN ('pezinho', 'barba', 'sobrancelha')
     )
     OR cardinality(v_adicionais) <> (
       SELECT count(DISTINCT extra.codigo)
       FROM unnest(v_adicionais) AS extra(codigo)
     )
  THEN
    RAISE EXCEPTION 'Lista de adicionais inválida ou repetida.';
  END IF;

  SELECT regexp_split_to_array(lower(btrim(s.nome)), '\s*\+\s*')
  INTO v_incluidos
  FROM public.servicos AS s
  WHERE s.id = v_agendamento.servico_id;

  FOREACH v_adicional IN ARRAY v_adicionais
  LOOP
    IF v_adicional = ANY(v_incluidos) THEN
      RAISE EXCEPTION
        'O adicional % já faz parte do serviço agendado.', v_adicional;
    END IF;

  END LOOP;

  IF v_agendamento.categoria = 'plano' THEN
    SELECT ass.id, ass.plano_id, pl.componentes_incluidos
    INTO v_assinatura_id, v_plano_id, v_cobertos
    FROM public.clientes AS c
    JOIN public.assinaturas AS ass ON ass.cliente_id = c.id
    JOIN public.planos AS pl ON pl.id = ass.plano_id
    JOIN public.pagamentos_planos AS pp ON pp.assinatura_id = ass.id
    WHERE public.normalizar_telefone_br(c.telefone) =
          public.normalizar_telefone_br(v_agendamento.telefone)
      AND c.ativo = true
      AND pl.ativo = true
      AND ass.status = 'ativa'
      AND v_hoje BETWEEN ass.data_inicio AND ass.data_fim
      AND pp.status = 'pago'
      AND v_hoje BETWEEN pp.vigencia_inicio AND pp.vigencia_fim
      AND pp.data_pagamento <= now()
    ORDER BY ass.data_fim DESC, ass.id DESC, pp.data_pagamento DESC
    LIMIT 1
    FOR SHARE OF c, ass, pl, pp;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Plano sem vigência ou pagamento confirmado para a data do atendimento. Renove o plano ou regularize o atendimento como avulso antes de concluir.';
    END IF;

    v_pontos_final := public.pontos_cobertos_do_servico(
      v_agendamento.servico_id, v_plano_id, v_adicionais
    );
  ELSIF v_agendamento.categoria = 'avulso' THEN
    v_pontos_final := 0;
  ELSE
    RAISE EXCEPTION 'Categoria de atendimento inválida.';
  END IF;

  FOREACH v_adicional IN ARRAY v_adicionais
  LOOP
    IF v_agendamento.categoria = 'plano' AND v_adicional = ANY(v_cobertos) THEN
      CONTINUE;
    END IF;

    v_preco_extra := public.preco_do_adicional(v_adicional);
    IF v_preco_extra IS NULL OR v_preco_extra < 0 THEN
      RAISE EXCEPTION 'Preço não configurado para o adicional %.', v_adicional;
    END IF;
    v_total_extras := v_total_extras + v_preco_extra;
  END LOOP;

  UPDATE public.agendamentos
  SET adicionais = v_adicionais,
      preco_cobrado = v_agendamento.preco_cobrado + v_total_extras,
      pontos_gerados = v_pontos_final,
      assinatura_id = v_assinatura_id,
      status = 'concluido'
  WHERE id = v_agendamento.id;

  -- O trigger existente cria o atendimento com a pontuação final.
  UPDATE public.atendimentos
  SET adicionais = v_adicionais
  WHERE agendamento_id = v_agendamento.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível registrar o histórico do atendimento.';
  END IF;

  RETURN v_pontos_final;
END;
$function$;


-- Endpoint novo: mantém clientes antigos compatíveis e entrega a prévia do cálculo.
CREATE OR REPLACE FUNCTION public.listar_agendamentos_painel_v2()
RETURNS TABLE(
  id bigint,nome_cliente text,telefone text,barbeiro_id bigint,barbeiro_nome text,
  servico_id bigint,servico_nome text,data date,horario_inicio time,horario_fim time,
  categoria text,status text,preco_cobrado numeric,pontos_gerados integer,
  componentes_cobertos text[],plano_nome text,precos_adicionais jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public
AS $function$
  SELECT old.id,old.nome_cliente,old.telefone,old.barbeiro_id,old.barbeiro_nome,
    old.servico_id,old.servico_nome,old.data,old.horario_inicio,old.horario_fim,
    old.categoria,old.status,old.preco_cobrado,
    CASE WHEN old.status='agendado' THEN
      CASE WHEN old.categoria='plano' AND plano.id IS NOT NULL
        THEN public.pontos_cobertos_do_servico(old.servico_id,plano.id,'{}')
        ELSE 0 END
      ELSE old.pontos_gerados END,
    coalesce(plano.componentes_incluidos,'{}'::text[]),plano.nome,
    (SELECT jsonb_object_agg(extra.codigo,
      CASE WHEN extra.codigo=ANY(coalesce(plano.componentes_incluidos,'{}'::text[]))
        THEN 0 ELSE public.preco_do_adicional(extra.codigo) END)
      FROM unnest(ARRAY['pezinho','barba','sobrancelha']) AS extra(codigo))
  FROM public.listar_agendamentos_painel() AS old
  JOIN public.agendamentos AS a ON a.id=old.id
  LEFT JOIN public.assinaturas AS original ON original.id=a.assinatura_id
  LEFT JOIN LATERAL (
    SELECT pl.id,pl.nome,pl.componentes_incluidos
    FROM public.assinaturas AS ass JOIN public.planos AS pl ON pl.id=ass.plano_id
    WHERE old.categoria='plano' AND old.status='agendado'
      AND ass.cliente_id=original.cliente_id AND ass.status='ativa' AND pl.ativo
      AND greatest(old.data,timezone('America/Sao_Paulo',now())::date)
        BETWEEN ass.data_inicio AND ass.data_fim
      AND EXISTS(SELECT 1 FROM public.pagamentos_planos AS pp
        WHERE pp.assinatura_id=ass.id AND pp.status='pago' AND pp.data_pagamento<=now()
          AND greatest(old.data,timezone('America/Sao_Paulo',now())::date)
            BETWEEN pp.vigencia_inicio AND pp.vigencia_fim)
    ORDER BY ass.data_fim DESC,ass.id DESC LIMIT 1
  ) AS plano ON true
  ORDER BY old.data,old.horario_inicio;
$function$;

REVOKE ALL ON FUNCTION public.listar_agendamentos_painel_v2()
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.listar_agendamentos_painel_v2() TO authenticated;

-- Origem: 20261102010000_catalogo_cinco_planos.sql
-- Catálogo confirmado: cinco planos, com os preços e coberturas vigentes.
-- Preserva IDs dos planos antigos, assinaturas e pagamentos registrados.

ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS codigo text;

UPDATE public.planos
SET codigo=CASE regexp_replace(lower(btrim(nome)),'[^[:alnum:]]','','g')
  WHEN 'essencial' THEN 'cabelo'
  WHEN 'cabelo' THEN 'cabelo'
  WHEN 'corte' THEN 'cabelo'
  WHEN 'clássico' THEN 'cabelo_sobrancelha'
  WHEN 'classico' THEN 'cabelo_sobrancelha'
  WHEN 'cabeloesobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'cabelosobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'corteesobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'cortesobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'cabeloebarba' THEN 'cabelo_barba'
  WHEN 'cabelobarba' THEN 'cabelo_barba'
  WHEN 'corteebarba' THEN 'cabelo_barba'
  WHEN 'cortebarba' THEN 'cabelo_barba'
  WHEN 'premium' THEN 'completo'
  WHEN 'completo' THEN 'completo'
  WHEN 'cabelobarbaesobrancelha' THEN 'completo'
  WHEN 'cabeloebarbaesobrancelha' THEN 'completo'
  WHEN 'cabelobarbasobrancelha' THEN 'completo'
  WHEN 'cortebarbaesobrancelha' THEN 'completo'
  WHEN 'cortebarbasobrancelha' THEN 'completo'
  WHEN 'barba' THEN 'barba'
  ELSE NULL END
WHERE codigo IS NULL;

DO $guard$
BEGIN
  IF EXISTS(SELECT codigo FROM public.planos WHERE codigo IS NOT NULL
    GROUP BY codigo HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Há planos duplicados para a mesma cobertura. Revise os IDs antes de atualizar o catálogo.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.planos WHERE ativo AND
    (codigo IS NULL OR codigo NOT IN ('cabelo','cabelo_barba','cabelo_sobrancelha','completo','barba'))) THEN
    RAISE EXCEPTION 'Há um plano ativo não identificado no catálogo de cinco planos. Revise o cadastro.';
  END IF;
END;
$guard$;

CREATE UNIQUE INDEX IF NOT EXISTS planos_codigo_unico ON public.planos(codigo);

CREATE OR REPLACE FUNCTION public.validar_cobertura_plano()
RETURNS trigger LANGUAGE plpgsql SET search_path TO public
AS $function$
BEGIN
  IF cardinality(NEW.componentes_incluidos)=0 THEN
    NEW.componentes_incluidos := CASE NEW.codigo
      WHEN 'cabelo' THEN ARRAY['corte']
      WHEN 'cabelo_barba' THEN ARRAY['corte','barba']
      WHEN 'cabelo_sobrancelha' THEN ARRAY['corte','sobrancelha']
      WHEN 'completo' THEN ARRAY['corte','barba','sobrancelha']
      WHEN 'barba' THEN ARRAY['barba']
      ELSE NEW.componentes_incluidos END;
  END IF;
  IF NEW.ativo AND cardinality(NEW.componentes_incluidos)=0 THEN
    RAISE EXCEPTION 'Configure os serviços incluídos antes de ativar o plano.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.validar_cobertura_plano()
FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO public.planos(codigo,nome,preco_mensal,descricao,componentes_incluidos,ativo)
VALUES
  ('cabelo','Cabelo',59.90,'Cortes de cabelo ilimitados por 30 dias.',ARRAY['corte'],true),
  ('cabelo_barba','Cabelo e Barba',89.90,'Cabelo e barba ilimitados por 30 dias.',ARRAY['corte','barba'],true),
  ('cabelo_sobrancelha','Cabelo e Sobrancelha',79.90,'Cabelo e sobrancelha ilimitados por 30 dias.',ARRAY['corte','sobrancelha'],true),
  ('completo','Cabelo, Barba e Sobrancelha',99.90,'Cabelo, barba e sobrancelha ilimitados por 30 dias.',ARRAY['corte','barba','sobrancelha'],true),
  ('barba','Barba',49.90,'Barbas ilimitadas por 30 dias.',ARRAY['barba'],true)
ON CONFLICT(codigo) DO UPDATE SET
  nome=excluded.nome,
  preco_mensal=excluded.preco_mensal,
  descricao=excluded.descricao,
  componentes_incluidos=excluded.componentes_incluidos,
  ativo=true;

-- Sincroniza a tabela de descontos usada nas consultas administrativas.
-- O cálculo de agendamento também usa diretamente a cobertura do plano.
DELETE FROM public.plano_servicos AS ps
USING public.planos AS pl,public.servicos AS s
WHERE ps.plano_id=pl.id AND ps.servico_id=s.id
  AND pl.codigo IN ('cabelo','cabelo_barba','cabelo_sobrancelha','completo','barba')
  AND cardinality(public.componentes_do_servico(s.nome))>0
  AND NOT(public.componentes_do_servico(s.nome) && pl.componentes_incluidos);

INSERT INTO public.plano_servicos(plano_id,servico_id,valor_desconto)
SELECT pl.id,s.id,public.desconto_coberto_do_servico(s.id,pl.id)
FROM public.planos AS pl CROSS JOIN public.servicos AS s
WHERE pl.codigo IN ('cabelo','cabelo_barba','cabelo_sobrancelha','completo','barba')
  AND public.componentes_do_servico(s.nome) && pl.componentes_incluidos
ON CONFLICT(plano_id,servico_id) DO UPDATE SET valor_desconto=excluded.valor_desconto;

COMMIT;
