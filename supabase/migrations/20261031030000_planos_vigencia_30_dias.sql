-- Pagamentos passam a cobrir períodos, independentemente do mês.
-- A vigência cadastrada antes desta migração é preservada.
BEGIN;

ALTER TABLE public.pagamentos_planos
  ADD COLUMN IF NOT EXISTS vigencia_inicio date,
  ADD COLUMN IF NOT EXISTS vigencia_fim date,
  ADD COLUMN IF NOT EXISTS registrado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chave_operacao uuid;

-- Único pagamento legado informado e conferido pelo responsável.
UPDATE public.pagamentos_planos AS pp
SET vigencia_inicio = a.data_inicio,
    vigencia_fim = a.data_fim
FROM public.assinaturas AS a
WHERE pp.id = 1
  AND a.id = 1
  AND pp.assinatura_id = a.id
  AND a.data_inicio = DATE '2026-10-02'
  AND a.data_fim = DATE '2026-11-02'
  AND pp.valor_pago = 60
  AND pp.mes_referencia = DATE '2026-10-01'
  AND pp.data_pagamento = TIMESTAMPTZ '2026-10-02 17:15:08.954906+00'
  AND pp.status = 'pago'
  AND pp.vigencia_inicio IS NULL
  AND pp.vigencia_fim IS NULL;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.pagamentos_planos
    WHERE status = 'pago'
      AND (vigencia_inicio IS NULL OR vigencia_fim IS NULL)
  ) THEN
    RAISE EXCEPTION
      'Há pagamento confirmado sem vigência conhecida. Confira os dados antes de aplicar esta migração.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pagamentos_planos'::regclass
      AND conname = 'pagamentos_planos_vigencia_valida'
  ) THEN
    ALTER TABLE public.pagamentos_planos
      ADD CONSTRAINT pagamentos_planos_vigencia_valida CHECK (
        (vigencia_inicio IS NULL AND vigencia_fim IS NULL)
        OR (vigencia_inicio IS NOT NULL AND vigencia_fim IS NOT NULL
            AND vigencia_fim >= vigencia_inicio)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pagamentos_planos'::regclass
      AND conname = 'pagamentos_confirmados_com_vigencia'
  ) THEN
    ALTER TABLE public.pagamentos_planos
      ADD CONSTRAINT pagamentos_confirmados_com_vigencia CHECK (
        status <> 'pago'
        OR (vigencia_inicio IS NOT NULL AND vigencia_fim IS NOT NULL)
      );
  END IF;
END;
$migration$;

-- Permite mais de uma renovação no mesmo mês.
ALTER TABLE public.pagamentos_planos
  DROP CONSTRAINT IF EXISTS pagamentos_planos_assinatura_id_mes_referencia_key;

CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_planos_operacao_unica
ON public.pagamentos_planos(chave_operacao)
WHERE chave_operacao IS NOT NULL;

CREATE INDEX IF NOT EXISTS pagamentos_planos_busca_vigencia
ON public.pagamentos_planos(assinatura_id, vigencia_inicio, vigencia_fim)
WHERE status = 'pago';

CREATE OR REPLACE FUNCTION public.normalizar_telefone_br(p_telefone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_telefone text := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
BEGIN
  IF length(v_telefone) IN (12, 13) AND left(v_telefone, 2) = '55' THEN
    v_telefone := substr(v_telefone, 3);
  END IF;

  IF length(v_telefone) NOT IN (10, 11) THEN
    RETURN NULL;
  END IF;

  RETURN v_telefone;
END;
$function$;

REVOKE ALL ON FUNCTION public.normalizar_telefone_br(text)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.registrar_pagamento_plano(
  p_nome_cliente text,
  p_telefone text,
  p_plano_id bigint,
  p_forma_pagamento text,
  p_pagamento_recebido boolean,
  p_chave_operacao uuid
)
RETURNS TABLE(
  pagamento_id bigint,
  assinatura_id bigint,
  plano text,
  valor_pago numeric,
  data_inicio_vigencia date,
  data_fim_vigencia date,
  renovacao_antecipada boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_telefone text := public.normalizar_telefone_br(p_telefone);
  v_hoje date := timezone('America/Sao_Paulo', now())::date;
  v_cliente_id bigint;
  v_cliente_ativo boolean;
  v_quantidade integer;
  v_plano_nome text;
  v_preco numeric;
  v_assinatura public.assinaturas%ROWTYPE;
  v_pagamento public.pagamentos_planos%ROWTYPE;
  v_inicio date;
  v_fim date;
  v_assinatura_id bigint;
  v_pagamento_id bigint;
BEGIN
  PERFORM 1 FROM public.perfis AS p
  WHERE p.usuario_id = auth.uid() AND p.ativo = true
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não autorizado.';
  END IF;

  IF p_pagamento_recebido IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirme que o pagamento foi recebido.';
  END IF;

  IF btrim(coalesce(p_nome_cliente, '')) = '' THEN
    RAISE EXCEPTION 'Informe o nome do cliente.';
  END IF;

  IF v_telefone IS NULL THEN
    RAISE EXCEPTION 'Informe um telefone válido com DDD.';
  END IF;

  IF btrim(coalesce(p_forma_pagamento, '')) = ''
     OR length(btrim(p_forma_pagamento)) > 40 THEN
    RAISE EXCEPTION 'Informe a forma de pagamento.';
  END IF;

  IF p_chave_operacao IS NULL THEN
    RAISE EXCEPTION 'Identificação do pagamento não informada.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('pagamento:' || p_chave_operacao::text, 0)
  );

  SELECT pp.* INTO v_pagamento
  FROM public.pagamentos_planos AS pp
  WHERE pp.chave_operacao = p_chave_operacao;

  IF FOUND THEN
    IF v_pagamento.registrado_por IS DISTINCT FROM auth.uid()
       OR v_pagamento.status <> 'pago'
       OR v_pagamento.forma_pagamento IS DISTINCT FROM btrim(p_forma_pagamento)
       OR NOT EXISTS (
         SELECT 1
         FROM public.assinaturas AS a
         JOIN public.clientes AS c ON c.id = a.cliente_id
         WHERE a.id = v_pagamento.assinatura_id
           AND a.plano_id = p_plano_id
           AND public.normalizar_telefone_br(c.telefone) = v_telefone
       )
    THEN
      RAISE EXCEPTION
        'Essa identificação de pagamento já foi utilizada em outra operação.';
    END IF;

    RETURN QUERY
    SELECT pp.id, a.id, pl.nome, pp.valor_pago,
           pp.vigencia_inicio, pp.vigencia_fim,
           pp.vigencia_inicio >
             timezone('America/Sao_Paulo', pp.data_pagamento)::date
    FROM public.pagamentos_planos AS pp
    JOIN public.assinaturas AS a ON a.id = pp.assinatura_id
    JOIN public.planos AS pl ON pl.id = a.plano_id
    WHERE pp.id = v_pagamento.id;
    RETURN;
  END IF;

  SELECT pl.nome, pl.preco_mensal
  INTO v_plano_nome, v_preco
  FROM public.planos AS pl
  WHERE pl.id = p_plano_id AND pl.ativo = true
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano inválido ou inativo.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('cliente:' || v_telefone, 0)
  );

  SELECT count(*) INTO v_quantidade
  FROM public.clientes AS c
  WHERE public.normalizar_telefone_br(c.telefone) = v_telefone;

  IF v_quantidade > 1 THEN
    RAISE EXCEPTION
      'Há mais de um cadastro com este telefone. Corrija a duplicidade antes de continuar.';
  END IF;

  SELECT c.id, c.ativo INTO v_cliente_id, v_cliente_ativo
  FROM public.clientes AS c
  WHERE public.normalizar_telefone_br(c.telefone) = v_telefone
  FOR UPDATE;

  IF FOUND THEN
    IF NOT v_cliente_ativo THEN
      RAISE EXCEPTION 'O cadastro deste cliente está inativo.';
    END IF;
  ELSE
    INSERT INTO public.clientes(nome, telefone)
    VALUES (btrim(p_nome_cliente), v_telefone)
    RETURNING id INTO v_cliente_id;
  END IF;

  SELECT count(*) INTO v_quantidade
  FROM public.assinaturas AS a
  WHERE a.cliente_id = v_cliente_id
    AND a.status = 'ativa'
    AND a.data_fim >= v_hoje;

  IF v_quantidade > 1 THEN
    RAISE EXCEPTION
      'Há mais de uma assinatura vigente para este cliente. Confira os cadastros.';
  END IF;

  SELECT a.* INTO v_assinatura
  FROM public.assinaturas AS a
  WHERE a.cliente_id = v_cliente_id
    AND a.status = 'ativa'
    AND a.data_fim >= v_hoje
  ORDER BY a.data_fim DESC, a.id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.pagamentos_planos AS pp
      WHERE pp.assinatura_id = v_assinatura.id
        AND pp.status = 'pago'
        AND pp.data_pagamento <= now()
        AND v_hoje BETWEEN pp.vigencia_inicio AND pp.vigencia_fim
    ) THEN
      RAISE EXCEPTION
        'A assinatura está sem pagamento válido para hoje. Regularize sua situação antes de renovar.';
    END IF;

    IF v_assinatura.plano_id <> p_plano_id THEN
      RAISE EXCEPTION
        'O cliente possui outro plano vigente. A renovação antecipada deve manter o mesmo plano.';
    END IF;

    v_inicio := v_assinatura.data_fim + 1;
    v_fim := v_inicio + 29;
    v_assinatura_id := v_assinatura.id;

    UPDATE public.assinaturas
    SET data_fim = v_fim
    WHERE id = v_assinatura_id;
  ELSE
    v_inicio := v_hoje;
    v_fim := v_inicio + 29;

    UPDATE public.assinaturas AS a
    SET status = 'expirada'
    WHERE a.cliente_id = v_cliente_id
      AND a.status = 'ativa'
      AND a.data_fim < v_hoje;

    INSERT INTO public.assinaturas(
      cliente_id, plano_id, data_inicio, data_fim, status
    )
    VALUES (v_cliente_id, p_plano_id, v_inicio, v_fim, 'ativa')
    RETURNING id INTO v_assinatura_id;
  END IF;

  INSERT INTO public.pagamentos_planos(
    assinatura_id, valor_pago, mes_referencia, data_pagamento,
    forma_pagamento, status, vigencia_inicio, vigencia_fim,
    registrado_por, chave_operacao
  )
  VALUES (
    v_assinatura_id, v_preco,
    date_trunc('month', v_hoje::timestamp)::date, now(),
    btrim(p_forma_pagamento), 'pago', v_inicio, v_fim,
    auth.uid(), p_chave_operacao
  )
  RETURNING id INTO v_pagamento_id;

  RETURN QUERY
  SELECT v_pagamento_id, v_assinatura_id, v_plano_nome, v_preco,
         v_inicio, v_fim, v_inicio > v_hoje;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_pagamento_plano(text, text, bigint, text, boolean, uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.registrar_pagamento_plano(text, text, bigint, text, boolean, uuid)
TO authenticated;

CREATE OR REPLACE FUNCTION public.listar_planos_painel()
RETURNS TABLE(id bigint, nome text, preco_mensal numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT pl.id, pl.nome, pl.preco_mensal
  FROM public.planos AS pl
  WHERE pl.ativo = true
    AND EXISTS (
      SELECT 1 FROM public.perfis AS p
      WHERE p.usuario_id = auth.uid() AND p.ativo = true
    )
  ORDER BY pl.preco_mensal, pl.nome;
$function$;

REVOKE ALL ON FUNCTION public.listar_planos_painel()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.listar_planos_painel()
TO authenticated;

-- O pagamento agora deve cobrir a data, mesmo que o mês seja outro.
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

  if p_categoria not in ('avulso', 'plano') then
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

    select coalesce(
      (
        select ps.valor_desconto
        from public.plano_servicos as ps
        where ps.plano_id = v_plano_id
          and ps.servico_id = p_servico_id
      ),
      0
    )
    into v_valor_desconto;

    v_preco_cobrado :=
      greatest(v_preco - v_valor_desconto, 0);
  else
    v_preco_cobrado := v_preco;
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
  v_pontos_extras integer := 0;
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

    v_pontos_extras := v_pontos_extras + CASE v_adicional
      WHEN 'pezinho' THEN 10
      WHEN 'barba' THEN 20
      WHEN 'sobrancelha' THEN 10
    END;
  END LOOP;

  IF v_agendamento.categoria = 'plano' THEN
    SELECT ass.id
    INTO v_assinatura_id
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

    v_pontos_final := v_agendamento.pontos_gerados + v_pontos_extras;
  ELSIF v_agendamento.categoria = 'avulso' THEN
    v_pontos_final := 0;
  ELSE
    RAISE EXCEPTION 'Categoria de atendimento inválida.';
  END IF;

  UPDATE public.agendamentos
  SET adicionais = v_adicionais,
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

COMMIT;
