-- Funções exportadas do Supabase em 2026-10-25.
-- Origem: consulta aos catálogos pg_proc e pg_namespace do esquema public.
-- Os corpos das funções foram preservados; apenas as quebras de linha e
-- o ponto e vírgula que encerra cada CREATE FUNCTION foram normalizados.
--
-- Este arquivo registra as definições atuais; não é uma instalação completa.
-- Tabelas, constraints, extensões, vínculos dos triggers e privilégios de
-- execução precisam ser exportados e revisados em conjunto.

-- Função: atualizar_status_agendamento
CREATE OR REPLACE FUNCTION public.atualizar_status_agendamento(p_agendamento_id bigint, p_status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tipo text;
  v_barbeiro_id bigint;
begin
  if p_status not in ('concluido', 'cancelado') then
    raise exception 'Status inválido.';
  end if;

  select
    p.tipo,
    p.barbeiro_id
  into
    v_tipo,
    v_barbeiro_id
  from public.perfis as p
  where p.usuario_id = auth.uid()
    and p.ativo = true;

  if not found then
    raise exception 'Usuário não autorizado.';
  end if;

  update public.agendamentos as a
  set status = p_status
  where a.id = p_agendamento_id
    and a.status = 'agendado'
    and (
      v_tipo = 'admin'
      or a.barbeiro_id = v_barbeiro_id
    );

  if not found then
    raise exception
      'Agendamento não encontrado, já finalizado ou pertence a outro barbeiro.';
  end if;

  return p_status;
end;
$function$;

-- Função: criar_agendamento
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
    where regexp_replace(c.telefone, '[^0-9]', '', 'g') =
          regexp_replace(p_telefone, '[^0-9]', '', 'g')
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
        and pp.mes_referencia =
            date_trunc('month', p_data::timestamp)::date
    ) then
      raise exception 'O pagamento do plano não está confirmado para este mês.';
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

-- Função: criar_agendamento_com_resumo
CREATE OR REPLACE FUNCTION public.criar_agendamento_com_resumo(p_nome_cliente text, p_telefone text, p_barbeiro_id bigint, p_servico_id bigint, p_data date, p_horario_inicio time without time zone, p_categoria text)
 RETURNS TABLE(id bigint, horario_final time without time zone, preco_normal numeric, valor_desconto numeric, valor_cobrado numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agendamento_id bigint;
  v_horario_final time;
begin
  select
    resultado.id,
    resultado.horario_final
  into
    v_agendamento_id,
    v_horario_final
  from public.criar_agendamento(
    p_nome_cliente,
    p_telefone,
    p_barbeiro_id,
    p_servico_id,
    p_data,
    p_horario_inicio,
    p_categoria
  ) as resultado;

  return query
  select
    a.id,
    a.horario_fim,
    s.preco,
    greatest(
      s.preco - a.preco_cobrado,
      0::numeric
    ),
    a.preco_cobrado
  from public.agendamentos as a
  join public.servicos as s
    on s.id = a.servico_id
  where a.id = v_agendamento_id;
end;
$function$;

-- Função: criar_bloqueio
CREATE OR REPLACE FUNCTION public.criar_bloqueio(p_barbeiro_id bigint, p_data date, p_dia_inteiro boolean, p_horario_inicio time without time zone, p_horario_fim time without time zone, p_motivo text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tipo text;
  v_barbeiro_perfil bigint;
  v_horario_inicio time;
  v_horario_fim time;
  v_bloqueio_id bigint;
begin
  select
    p.tipo,
    p.barbeiro_id
  into
    v_tipo,
    v_barbeiro_perfil
  from public.perfis as p
  where p.usuario_id = auth.uid()
    and p.ativo = true;

  if not found then
    raise exception 'Usuário não autorizado.';
  end if;

  if p_barbeiro_id is null then
    raise exception 'Informe o barbeiro.';
  end if;

  if v_tipo <> 'admin'
    and v_barbeiro_perfil <> p_barbeiro_id
  then
    raise exception
      'Você não pode bloquear o horário de outro barbeiro.';
  end if;

  perform 1
  from public.barbeiros as b
  where b.id = p_barbeiro_id
    and b.ativo = true;

  if not found then
    raise exception 'Barbeiro inválido ou inativo.';
  end if;

  if p_data < timezone('America/Sao_Paulo', now())::date then
    raise exception 'Não é possível bloquear uma data que já passou.';
  end if;

  if p_dia_inteiro then
    v_horario_inicio := time '00:00';
    v_horario_fim := time '23:59:59';
  else
    v_horario_inicio := p_horario_inicio;
    v_horario_fim := p_horario_fim;

    if v_horario_inicio is null
      or v_horario_fim is null
      or v_horario_inicio >= v_horario_fim
    then
      raise exception 'Informe um intervalo de horário válido.';
    end if;
  end if;

  if exists (
    select 1
    from public.bloqueios as bl
    where bl.barbeiro_id = p_barbeiro_id
      and bl.data = p_data
      and bl.ativo = true
      and v_horario_inicio < bl.horario_fim
      and v_horario_fim > bl.horario_inicio
  ) then
    raise exception 'Já existe um bloqueio nesse período.';
  end if;

  if exists (
    select 1
    from public.agendamentos as a
    where a.barbeiro_id = p_barbeiro_id
      and a.data = p_data
      and a.status <> 'cancelado'
      and v_horario_inicio < a.horario_fim
      and v_horario_fim > a.horario_inicio
  ) then
    raise exception
      'Existem agendamentos nesse período. Cancele ou reorganize os atendimentos primeiro.';
  end if;

  insert into public.bloqueios (
    barbeiro_id,
    data,
    dia_inteiro,
    horario_inicio,
    horario_fim,
    motivo,
    ativo
  )
  values (
    p_barbeiro_id,
    p_data,
    p_dia_inteiro,
    v_horario_inicio,
    v_horario_fim,
    coalesce(
      nullif(btrim(p_motivo), ''),
      'Indisponível'
    ),
    true
  )
  returning id into v_bloqueio_id;

  return v_bloqueio_id;
end;
$function$;

-- Função: desativar_bloqueio
CREATE OR REPLACE FUNCTION public.desativar_bloqueio(p_bloqueio_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tipo text;
  v_barbeiro_perfil bigint;
begin
  select
    p.tipo,
    p.barbeiro_id
  into
    v_tipo,
    v_barbeiro_perfil
  from public.perfis as p
  where p.usuario_id = auth.uid()
    and p.ativo = true;

  if not found then
    raise exception 'Usuário não autorizado.';
  end if;

  update public.bloqueios as bl
  set ativo = false
  where bl.id = p_bloqueio_id
    and bl.ativo = true
    and (
      v_tipo = 'admin'
      or bl.barbeiro_id = v_barbeiro_perfil
    );

  if not found then
    raise exception
      'Bloqueio não encontrado ou pertence a outro barbeiro.';
  end if;

  return p_bloqueio_id;
end;
$function$;

-- Função: listar_agendamentos_admin
CREATE OR REPLACE FUNCTION public.listar_agendamentos_admin()
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
    s.nome as servico_nome,
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
  order by a.data, a.horario_inicio;
$function$;

-- Função: listar_agendamentos_painel
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
    s.nome as servico_nome,
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

-- Função: listar_bloqueios_painel
CREATE OR REPLACE FUNCTION public.listar_bloqueios_painel()
 RETURNS TABLE(id bigint, barbeiro_id bigint, barbeiro_nome text, data date, dia_inteiro boolean, horario_inicio time without time zone, horario_fim time without time zone, motivo text, criado_em timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    bl.id,
    bl.barbeiro_id,
    b.nome as barbeiro_nome,
    bl.data,
    bl.dia_inteiro,
    bl.horario_inicio,
    bl.horario_fim,
    bl.motivo,
    bl.criado_em
  from public.bloqueios as bl
  inner join public.barbeiros as b
    on b.id = bl.barbeiro_id
  inner join public.perfis as p
    on p.usuario_id = auth.uid()
    and p.ativo = true
    and (
      p.tipo = 'admin'
      or p.barbeiro_id = bl.barbeiro_id
    )
  where bl.ativo = true
    and bl.data >=
      timezone('America/Sao_Paulo', now())::date
  order by
    bl.data,
    bl.horario_inicio,
    b.nome;
$function$;

-- Função: listar_horarios_disponiveis
CREATE OR REPLACE FUNCTION public.listar_horarios_disponiveis(p_barbeiro_id bigint, p_servico_id bigint, p_data date)
 RETURNS TABLE(horario time without time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_duracao integer;
  v_dia_semana integer;
  v_agora timestamp := timezone('America/Sao_Paulo', now());
begin
  select s.duracao_minutos
  into v_duracao
  from public.servicos as s
  where s.id = p_servico_id
    and s.ativo = true;

  if not found then
    raise exception 'Serviço inválido ou inativo.';
  end if;

  if not exists (
    select 1
    from public.barbeiros as b
    where b.id = p_barbeiro_id
      and b.ativo = true
  ) then
    raise exception 'Barbeiro inválido ou inativo.';
  end if;

  v_dia_semana := extract(dow from p_data)::integer;

  return query
  select candidatos.inicio::time
  from (
    select generate_series(
      p_data + ht.horario_inicio,
      p_data + ht.horario_fim - make_interval(mins => v_duracao),
      interval '30 minutes'
    ) as inicio
    from public.horarios_trabalho as ht
    where ht.barbeiro_id = p_barbeiro_id
      and ht.dia_semana = v_dia_semana
      and ht.ativo = true
  ) as candidatos
  where (
    p_data > v_agora::date
    or candidatos.inicio::time > v_agora::time
  )
  and not exists (
    select 1
    from public.agendamentos as a
    where a.barbeiro_id = p_barbeiro_id
      and a.data = p_data
      and a.status <> 'cancelado'
      and candidatos.inicio::time < a.horario_fim
      and (
        candidatos.inicio + make_interval(mins => v_duracao)
      )::time > a.horario_inicio
  )
  and not exists (
    select 1
    from public.bloqueios as bl
    where bl.barbeiro_id = p_barbeiro_id
      and bl.data = p_data
      and bl.ativo = true
      and (
        bl.dia_inteiro = true
        or (
          candidatos.inicio::time < bl.horario_fim
          and (
            candidatos.inicio + make_interval(mins => v_duracao)
          )::time > bl.horario_inicio
        )
      )
  )
  order by candidatos.inicio;
end;
$function$;

-- Função: listar_horarios_ocupados
CREATE OR REPLACE FUNCTION public.listar_horarios_ocupados(p_barbeiro_id bigint, p_data date)
 RETURNS TABLE(horario_inicio time without time zone, horario_fim time without time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    a.horario_inicio,
    a.horario_fim
  from public.agendamentos as a
  where a.barbeiro_id = p_barbeiro_id
    and a.data = p_data
    and a.status <> 'cancelado'
  order by a.horario_inicio;
$function$;

-- Função: listar_ranking_mensal
CREATE OR REPLACE FUNCTION public.listar_ranking_mensal()
 RETURNS TABLE(posicao bigint, barbeiro_id bigint, barbeiro_nome text, total_atendimentos bigint, total_pontos bigint, faturamento numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ranking as (
    select
      b.id as barbeiro_id,
      b.nome as barbeiro_nome,
      count(a.id) as total_atendimentos,
      coalesce(sum(a.pontos_gerados), 0)::bigint as total_pontos,
      coalesce(sum(a.preco_cobrado), 0)::numeric as faturamento
    from public.barbeiros b
    left join public.atendimentos a
      on a.barbeiro_id = b.id
      and timezone('America/Sao_Paulo', a.realizado_em) >=
          date_trunc('month', timezone('America/Sao_Paulo', now()))
      and timezone('America/Sao_Paulo', a.realizado_em) <
          date_trunc('month', timezone('America/Sao_Paulo', now()))
          + interval '1 month'
    where b.ativo = true
    group by b.id, b.nome
  )
  select
    dense_rank() over (order by total_pontos desc) as posicao,
    barbeiro_id,
    barbeiro_nome,
    total_atendimentos,
    total_pontos,
    faturamento
  from ranking
  order by total_pontos desc, barbeiro_nome;
$function$;

-- Função: listar_ranking_pontos
CREATE OR REPLACE FUNCTION public.listar_ranking_pontos()
 RETURNS TABLE(posicao bigint, barbeiro_id bigint, barbeiro_nome text, total_atendimentos bigint, total_pontos bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ranking as (
    select
      b.id as barbeiro_id,
      b.nome as barbeiro_nome,
      count(a.id) as total_atendimentos,
      coalesce(sum(a.pontos_gerados), 0)::bigint as total_pontos
    from public.barbeiros as b
    left join public.atendimentos as a
      on a.barbeiro_id = b.id
      and timezone('America/Sao_Paulo', a.realizado_em) >=
          date_trunc(
            'month',
            timezone('America/Sao_Paulo', now())
          )
      and timezone('America/Sao_Paulo', a.realizado_em) <
          date_trunc(
            'month',
            timezone('America/Sao_Paulo', now())
          ) + interval '1 month'
    where b.ativo = true
    group by b.id, b.nome
  )
  select
    dense_rank() over (
      order by ranking.total_pontos desc
    ) as posicao,
    ranking.barbeiro_id,
    ranking.barbeiro_nome,
    ranking.total_atendimentos,
    ranking.total_pontos
  from ranking
  where exists (
    select 1
    from public.perfis as p
    where p.usuario_id = auth.uid()
      and p.ativo = true
  )
  order by
    ranking.total_pontos desc,
    ranking.barbeiro_nome;
$function$;

-- Função: registrar_atendimento_concluido
CREATE OR REPLACE FUNCTION public.registrar_atendimento_concluido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (
    new.status = 'concluido'
    and old.status is distinct from 'concluido'
  ) then
    insert into public.atendimentos (
      agendamento_id,
      barbeiro_id,
      servico_id,
      nome_cliente,
      categoria,
      preco_cobrado,
      pontos_gerados,
      realizado_em
    )
    values (
      new.id,
      new.barbeiro_id,
      new.servico_id,
      new.nome_cliente,
      new.categoria,
      new.preco_cobrado,
      new.pontos_gerados,
      now()
    )
    on conflict (agendamento_id) do nothing;
  end if;

  return new;
end;
$function$;

-- Função: rls_auto_enable
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- Função: usuario_eh_admin
CREATE OR REPLACE FUNCTION public.usuario_eh_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.perfis as p
    where p.usuario_id = auth.uid()
      and p.tipo = 'admin'
      and p.ativo = true
  );
$function$;

-- Função: validar_novo_agendamento
CREATE OR REPLACE FUNCTION public.validar_novo_agendamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agora timestamp := timezone('America/Sao_Paulo', now());
  v_dia_semana integer;
begin
  v_dia_semana := extract(dow from new.data)::integer;

  if new.horario_fim <= new.horario_inicio then
    raise exception 'O horário final precisa ser maior que o inicial.';
  end if;

  if (
    new.data < v_agora::date
    or (
      new.data = v_agora::date
      and new.horario_inicio <= v_agora::time
    )
  ) then
    raise exception 'Não é possível agendar em um horário passado.';
  end if;

  if not exists (
    select 1
    from public.horarios_trabalho as ht
    where ht.barbeiro_id = new.barbeiro_id
      and ht.dia_semana = v_dia_semana
      and ht.ativo = true
      and new.horario_inicio >= ht.horario_inicio
      and new.horario_fim <= ht.horario_fim
  ) then
    raise exception 'Horário fora do expediente do barbeiro.';
  end if;

  if exists (
    select 1
    from public.bloqueios as bl
    where bl.barbeiro_id = new.barbeiro_id
      and bl.data = new.data
      and bl.ativo = true
      and (
        bl.dia_inteiro = true
        or (
          bl.horario_inicio is not null
          and bl.horario_fim is not null
          and new.horario_inicio < bl.horario_fim
          and new.horario_fim > bl.horario_inicio
        )
      )
  ) then
    raise exception 'O barbeiro está indisponível nesse horário.';
  end if;

  if exists (
    select 1
    from public.agendamentos as a
    where a.barbeiro_id = new.barbeiro_id
      and a.data = new.data
      and coalesce(a.status, 'agendado') <> 'cancelado'
      and new.horario_inicio < a.horario_fim
      and new.horario_fim > a.horario_inicio
  ) then
    raise exception 'Este horário já está ocupado.';
  end if;

  return new;
end;
$function$;
