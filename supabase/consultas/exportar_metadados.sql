-- Execute em uma nova consulta no SQL Editor do Supabase.
-- Esta consulta lê somente definições e permissões; não consulta clientes
-- nem executa as funções da aplicação. Exporte o resultado como CSV.

with tabelas as (
  select c.*
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
), funcoes as (
  select p.*
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
)
select jsonb_pretty(jsonb_build_object(
  'versao_postgres', current_setting('server_version'),
  'tabelas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nome', t.relname,
      'tipo', t.relkind,
      'proprietario', pg_get_userbyid(t.relowner),
      'rls_habilitado', t.relrowsecurity,
      'rls_forcado', t.relforcerowsecurity,
      'acl', t.relacl::text
    ) order by t.relname), '[]'::jsonb)
    from tabelas t
  ),
  'colunas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'tabela', t.relname,
      'posicao', a.attnum,
      'nome', a.attname,
      'tipo', format_type(a.atttypid, a.atttypmod),
      'obrigatoria', a.attnotnull,
      'padrao_ou_expressao', pg_get_expr(d.adbin, d.adrelid),
      'identidade', a.attidentity,
      'gerada', a.attgenerated,
      'sequencia', pg_get_serial_sequence(
        format('%I.%I', 'public', t.relname), a.attname
      ),
      'acl', a.attacl::text
    ) order by t.relname, a.attnum), '[]'::jsonb)
    from tabelas t
    join pg_catalog.pg_attribute a on a.attrelid = t.oid
    left join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attnum > 0 and not a.attisdropped
  ),
  'restricoes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'tabela', case when c.conrelid <> 0 then c.conrelid::regclass::text end,
      'dominio', case when c.contypid <> 0 then c.contypid::regtype::text end,
      'nome', c.conname,
      'tipo', c.contype,
      'definicao', pg_get_constraintdef(c.oid, true),
      'validada', c.convalidated
    ) order by c.conrelid::regclass::text, c.conname), '[]'::jsonb)
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
  ),
  'indices', (
    select coalesce(jsonb_agg(to_jsonb(i) order by i.tablename, i.indexname), '[]'::jsonb)
    from pg_catalog.pg_indexes i
    where i.schemaname = 'public'
  ),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'tabela', t.relname,
      'nome', g.tgname,
      'habilitacao', g.tgenabled,
      'definicao', pg_get_triggerdef(g.oid, true)
    ) order by t.relname, g.tgname), '[]'::jsonb)
    from tabelas t
    join pg_catalog.pg_trigger g on g.tgrelid = t.oid
    where not g.tgisinternal
  ),
  'politicas', (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.tablename, p.policyname), '[]'::jsonb)
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
  ),
  'permissoes_tabelas', (
    select coalesce(jsonb_agg(to_jsonb(g) order by g.table_name, g.grantee, g.privilege_type), '[]'::jsonb)
    from information_schema.table_privileges g
    where g.table_schema = 'public'
  ),
  'permissoes_funcoes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nome', p.proname,
      'argumentos', pg_get_function_identity_arguments(p.oid),
      'proprietario', pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef,
      'acl', p.proacl::text,
      'anon_pode_executar', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_pode_executar', has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) order by p.proname, p.oid), '[]'::jsonb)
    from funcoes p
  ),
  'sequencias', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nome', c.relname,
      'tipo', format_type(s.seqtypid, null),
      'inicio', s.seqstart,
      'incremento', s.seqincrement,
      'minimo', s.seqmin,
      'maximo', s.seqmax,
      'cache', s.seqcache,
      'ciclica', s.seqcycle,
      'acl', c.relacl::text
    ) order by c.relname), '[]'::jsonb)
    from pg_catalog.pg_sequence s
    join pg_catalog.pg_class c on c.oid = s.seqrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ),
  'tipos', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nome', t.typname,
      'tipo', t.typtype,
      'tipo_base', case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
      'obrigatorio', t.typnotnull,
      'padrao', t.typdefault,
      'valores_enum', (
        select jsonb_agg(e.enumlabel order by e.enumsortorder)
        from pg_catalog.pg_enum e where e.enumtypid = t.oid
      )
    ) order by t.typname), '[]'::jsonb)
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e', 'd')
  ),
  'views', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nome', c.relname,
      'tipo', c.relkind,
      'proprietario', pg_get_userbyid(c.relowner),
      'opcoes', c.reloptions,
      'acl', c.relacl::text,
      'definicao', pg_get_viewdef(c.oid, true)
    ) order by c.relname), '[]'::jsonb)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
  ),
  'permissoes_padrao', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'proprietario', pg_get_userbyid(d.defaclrole),
      'esquema', n.nspname,
      'tipo_objeto', d.defaclobjtype,
      'acl', d.defaclacl::text
    ) order by d.defaclrole, d.defaclnamespace, d.defaclobjtype), '[]'::jsonb)
    from pg_catalog.pg_default_acl d
    left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclnamespace = 0 or n.nspname = 'public'
  ),
  'esquema_public', (
    select jsonb_build_object(
      'proprietario', pg_get_userbyid(n.nspowner),
      'acl', n.nspacl::text,
      'anon_pode_usar', has_schema_privilege('anon', n.oid, 'USAGE'),
      'authenticated_pode_usar', has_schema_privilege('authenticated', n.oid, 'USAGE')
    )
    from pg_catalog.pg_namespace n where n.nspname = 'public'
  ),
  'event_triggers_public', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nome', e.evtname,
      'evento', e.evtevent,
      'habilitacao', e.evtenabled,
      'tags', e.evttags,
      'funcao', e.evtfoid::regprocedure::text
    ) order by e.evtname), '[]'::jsonb)
    from pg_catalog.pg_event_trigger e
    join pg_catalog.pg_proc p on p.oid = e.evtfoid
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ),
  'extensoes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nome', e.extname,
      'versao', e.extversion,
      'esquema', n.nspname
    ) order by e.extname), '[]'::jsonb)
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  )
)) as estrutura;
