-- Conclusão com adicionais: registra serviços e pontos.
-- A cobrança dos adicionais será implementada separadamente.
BEGIN;

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS adicionais text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.atendimentos
  ADD COLUMN IF NOT EXISTS adicionais text[] NOT NULL DEFAULT '{}';

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
    WHERE regexp_replace(c.telefone, '[^0-9]', '', 'g') =
          regexp_replace(v_agendamento.telefone, '[^0-9]', '', 'g')
      AND c.ativo = true
      AND pl.ativo = true
      AND ass.status = 'ativa'
      AND v_hoje BETWEEN ass.data_inicio AND ass.data_fim
      AND pp.status = 'pago'
      AND pp.mes_referencia = date_trunc('month', v_hoje::timestamp)::date
      AND pp.data_pagamento <= now()
    ORDER BY ass.data_fim DESC, ass.id DESC, pp.data_pagamento DESC
    LIMIT 1
    FOR SHARE OF c, ass, pl, pp;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Plano sem vigência ou pagamento confirmado para o mês do atendimento. Renove o plano ou regularize o atendimento como avulso antes de concluir.';
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

REVOKE ALL ON FUNCTION public.concluir_agendamento_com_adicionais(bigint, text[])
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.concluir_agendamento_com_adicionais(bigint, text[])
TO authenticated;

-- Mantém clientes antigos sujeitos à mesma validação ao concluir.
CREATE OR REPLACE FUNCTION public.atualizar_status_agendamento(
  p_agendamento_id bigint,
  p_status text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo text;
  v_barbeiro_id bigint;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('concluido', 'cancelado') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  IF p_status = 'concluido' THEN
    PERFORM public.concluir_agendamento_com_adicionais(
      p_agendamento_id, '{}'::text[]
    );
    RETURN p_status;
  END IF;

  SELECT p.tipo, p.barbeiro_id
  INTO v_tipo, v_barbeiro_id
  FROM public.perfis AS p
  WHERE p.usuario_id = auth.uid()
    AND p.ativo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não autorizado.';
  END IF;

  UPDATE public.agendamentos AS a
  SET status = p_status
  WHERE a.id = p_agendamento_id
    AND a.status = 'agendado'
    AND (v_tipo = 'admin' OR a.barbeiro_id = v_barbeiro_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Agendamento não encontrado, já finalizado ou pertence a outro barbeiro.';
  END IF;

  RETURN p_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.atualizar_status_agendamento(bigint, text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.atualizar_status_agendamento(bigint, text)
TO authenticated;

-- Exibe os adicionais também no histórico da agenda.
CREATE OR REPLACE FUNCTION public.listar_agendamentos_painel()
 RETURNS TABLE(id bigint, nome_cliente text, telefone text, barbeiro_id bigint, barbeiro_nome text, servico_id bigint, servico_nome text, data date, horario_inicio time without time zone, horario_fim time without time zone, categoria text, status text, preco_cobrado numeric, pontos_gerados integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    a.id,
    a.nome_cliente,
    a.telefone,
    a.barbeiro_id,
    b.nome as barbeiro_nome,
    a.servico_id,
    concat_ws(
      ' + ',
      s.nome,
      nullif(
        (
          select string_agg(initcap(extra.codigo), ' + ' order by extra.ordem)
          from unnest(a.adicionais) with ordinality as extra(codigo, ordem)
        ),
        ''
      )
    ) as servico_nome,
    a.data,
    a.horario_inicio,
    a.horario_fim,
    a.categoria,
    a.status,
    a.preco_cobrado,
    a.pontos_gerados
  from public.agendamentos as a
  inner join public.barbeiros as b
    on b.id = a.barbeiro_id
  inner join public.servicos as s
    on s.id = a.servico_id
  where exists (
    select 1
    from public.perfis as p
    where p.usuario_id = auth.uid()
      and p.ativo = true
      and (
        p.tipo = 'admin'
        or p.barbeiro_id = a.barbeiro_id
      )
  )
  order by a.data, a.horario_inicio;
$function$;

COMMIT;
