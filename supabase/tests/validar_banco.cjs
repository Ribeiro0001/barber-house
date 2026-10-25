const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const root = path.resolve(__dirname, "..");
const metadata = JSON.parse(fs.readFileSync(path.join(root, "snapshots/20261025_metadados.json"), "utf8"));
const migration = fs.readFileSync(path.join(root, "migrations/20261025000000_estrutura_inicial.sql"), "utf8");
const db = new PGlite();
let flows = 0;

const admin = "00000000-0000-4000-8000-000000000001";
const barber = "00000000-0000-4000-8000-000000000002";

async function asRole(role, userId, action) {
  assert.ok(["anon", "authenticated"].includes(role));
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ""]);
  await db.exec(`SET ROLE ${role}`);
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

async function rejects(sql, params, message) {
  await assert.rejects(() => db.query(sql, params), message);
}

async function book(barberId, time, category = "avulso", phone = "22000000000") {
  const result = await db.query(
    `select * from public.criar_agendamento_com_resumo(
      $1, $2, $3, $4,
      timezone('America/Sao_Paulo', now())::date + 1,
      $5::time, $6
    )`,
    ["Cliente fictício", phone, barberId, 1, time, category],
  );
  return result.rows[0];
}

async function verifyStructure() {
  const tables = (await db.query("select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename")).rows;
  assert.deepEqual(tables.map(t => t.tablename), metadata.tabelas.map(t => t.nome));
  for (const table of tables) {
    assert.equal(table.rowsecurity, metadata.tabelas.find(t => t.nome === table.tablename).rls_habilitado);
  }
  const columns = (await db.query(`
    select c.relname as tabela, a.attname as nome,
      format_type(a.atttypid, a.atttypmod) as tipo,
      a.attnotnull as obrigatoria, a.attidentity as identidade,
      pg_get_expr(d.adbin, d.adrelid) as padrao_ou_expressao
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped
    order by c.relname, a.attnum
  `)).rows;
  assert.deepEqual(columns, metadata.colunas.map(({ tabela, nome, tipo, obrigatoria, identidade, padrao_ou_expressao }) => ({ tabela, nome, tipo, obrigatoria, identidade, padrao_ou_expressao })));
  const constraints = (await db.query(`
    select c.conname as nome, c.conrelid::regclass::text as tabela,
      pg_get_constraintdef(c.oid, true) as definicao
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.contype <> 'n'
    order by c.conrelid::regclass::text, c.conname
  `)).rows;
  assert.deepEqual(constraints, metadata.restricoes.map(({ nome, tabela, definicao }) => ({ nome, tabela, definicao })));
  const indexes = (await db.query("select indexdef from pg_indexes where schemaname = 'public' order by tablename, indexname")).rows;
  assert.deepEqual(indexes.map(i => i.indexdef), metadata.indices.map(i => i.indexdef));
  const policies = (await db.query("select policyname, tablename, cmd, qual, with_check, roles, permissive from pg_policies where schemaname='public' order by tablename, policyname")).rows;
  assert.deepEqual(policies, metadata.politicas.map(({ policyname, tablename, cmd, qual, with_check, roles, permissive }) => ({ policyname, tablename, cmd, qual, with_check, roles, permissive })));
  const triggers = (await db.query(`
    select t.tgname as nome, t.tgenabled as habilitacao,
      pg_get_triggerdef(t.oid, true) as definicao
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal order by t.tgname
  `)).rows;
  assert.deepEqual(triggers, metadata.triggers.map(({ nome, habilitacao, definicao }) => ({ nome, habilitacao, definicao })));
  const sequenceData = (await db.query(`
    select c.relname as nome, s.seqstart::text as inicio,
      s.seqincrement::text as incremento, s.seqmin::text as minimo,
      s.seqmax::text as maximo, s.seqcache::text as cache, s.seqcycle as ciclica
    from pg_sequence s join pg_class c on c.oid=s.seqrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' order by c.relname
  `)).rows;
  // Os limites bigint vêm do export JSON e excedem a precisão de Number em JS.
  // Comparamos a forma decimal usada pelo gerador SQL, além dos demais atributos.
  for (const seq of sequenceData) {
    const expected = metadata.sequencias.find(s => s.nome === seq.nome);
    assert.ok(expected);
    for (const key of ["inicio", "incremento", "minimo", "cache"]) assert.equal(seq[key], String(expected[key]));
    assert.equal(seq.maximo, "9223372036854775807");
    assert.equal(seq.ciclica, expected.ciclica);
  }
  for (const f of metadata.permissoes_funcoes.filter(f => f.nome !== "rls_auto_enable")) {
    const access = (await db.query(`
      select has_function_privilege('anon',p.oid,'EXECUTE') as anon,
        has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=$1
    `, [f.nome])).rows;
    assert.equal(access.length, 1);
    assert.equal(access[0].anon, f.anon_pode_executar, f.nome);
    assert.equal(access[0].authenticated, f.authenticated_pode_executar, f.nome);
  }
  const rights = { a: "INSERT", r: "SELECT", w: "UPDATE", d: "DELETE", D: "TRUNCATE", x: "REFERENCES", t: "TRIGGER", m: "MAINTAIN" };
  for (const table of metadata.tabelas) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const part = table.acl.slice(1, -1).split(",").find(p => p.startsWith(`${role}=`));
      const granted = part ? part.split("=")[1].split("/")[0] : "";
      for (const [code, privilege] of Object.entries(rights)) {
        const result = await db.query("select has_table_privilege($1,$2,$3) as allowed", [role, `public.${table.nome}`, privilege]);
        assert.equal(result.rows[0].allowed, granted.includes(code), `${table.nome}/${role}/${privilege}`);
      }
    }
  }
  console.log("Estrutura e permissões conferidas com os metadados exportados.");
}

async function verifyFlows() {
  await db.exec(`
    insert into auth.users(id) values ('${admin}'), ('${barber}');
    insert into public.barbeiros(nome,ativo) values ('Barbeiro fictício 1',true), ('Barbeiro fictício 2',true), ('Barbeiro inativo',false);
    insert into public.servicos(nome,duracao_minutos,preco,pontos,ativo) values ('Corte fictício',30,35,1,true), ('Serviço inativo',30,35,1,false);
    insert into public.horarios_trabalho(barbeiro_id,dia_semana,horario_inicio,horario_fim)
      select b,d,'09:00'::time,'18:00'::time from generate_series(1,2) b cross join generate_series(0,6) d;
    insert into public.perfis(usuario_id,nome,tipo,barbeiro_id) values
      ('${admin}','Administrador fictício','admin',null), ('${barber}','Barbeiro fictício 1','barbeiro',1);
  `);
  await asRole("anon", null, async () => {
    assert.equal((await db.query("select * from public.barbeiros")).rows.length, 2);
    assert.equal((await db.query("select * from public.servicos")).rows.length, 1);
    await rejects("select * from public.clientes", [], /permission denied/);
    await rejects("select * from public.listar_agendamentos_admin()", [], /permission denied/);
    await rejects("select * from public.listar_agendamentos_painel()", [], /permission denied/);
    flows += 5;
  });
  const first = await asRole("anon", null, () => book(1, "09:00"));
  const second = await asRole("anon", null, () => book(2, "09:00"));
  assert.equal(Number(first.valor_cobrado), 35);
  flows += 2;
  await asRole("anon", null, async () => {
    await assert.rejects(() => book(1, "09:15"), /indisponível/);
    await assert.rejects(() => book(1, "19:00"), /fora do expediente/);
    await assert.rejects(() => book(1, "12:00", "plano", "22000000099"), /Nenhum plano ativo/);
    await rejects(`select * from public.criar_agendamento('Teste','22000000000',1,1,
      timezone('America/Sao_Paulo',now())::date - 1,'09:00','avulso')`, [], /já passou/);
    flows += 4;
  });
  const block = await asRole("authenticated", admin, async () => {
    const rows = (await db.query("select * from public.listar_agendamentos_painel()")).rows;
    assert.equal(rows.length, 2);
    const result = await db.query(`select public.criar_bloqueio(1,
      timezone('America/Sao_Paulo',now())::date+1,false,'10:00','11:00','Bloqueio fictício') as id`);
    assert.equal((await db.query("select * from public.listar_bloqueios_painel()")).rows.length, 1);
    flows += 3;
    return result.rows[0].id;
  });
  await asRole("anon", null, async () => {
    await assert.rejects(() => book(1, "10:00"), /indisponível/);
    flows++;
  });
  await asRole("authenticated", barber, async () => {
    const rows = (await db.query("select * from public.listar_agendamentos_painel()")).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].barbeiro_id), 1);
    await rejects("select public.atualizar_status_agendamento($1,'concluido')", [second.id], /outro barbeiro/);
    await rejects(`select public.criar_bloqueio(2,timezone('America/Sao_Paulo',now())::date+1,
      false,'12:00','13:00','Outro barbeiro')`, [], /outro barbeiro/);
    await db.query("select public.atualizar_status_agendamento($1,'concluido')", [first.id]);
    await rejects("select public.atualizar_status_agendamento($1,'concluido')", [first.id], /já finalizado/);
    const ranking = (await db.query("select * from public.listar_ranking_pontos()")).rows;
    assert.equal(Number(ranking.find(r => Number(r.barbeiro_id) === 1).total_pontos), 1);
    flows += 6;
  });
  assert.equal(Number((await db.query("select count(*) as total from public.atendimentos")).rows[0].total), 1);
  flows++;
  await db.exec(`
    insert into public.clientes(nome,telefone) values ('Cliente de plano fictício','22000000001'), ('Cliente sem pagamento','22000000002');
    insert into public.planos(nome,preco_mensal) values ('Plano fictício',60);
    insert into public.plano_servicos(plano_id,servico_id,valor_desconto) values(1,1,20);
    insert into public.assinaturas(cliente_id,plano_id,data_inicio,data_fim)
      select id,1,current_date-1,current_date+60 from public.clientes;
    insert into public.pagamentos_planos(assinatura_id,valor_pago,mes_referencia)
      values(1,60,date_trunc('month',(timezone('America/Sao_Paulo',now())::date+1)::timestamp)::date);
  `);
  await asRole("anon", null, async () => {
    const paid = await book(1, "11:00", "plano", "22000000001");
    assert.equal(Number(paid.preco_normal), 35);
    assert.equal(Number(paid.valor_desconto), 20);
    assert.equal(Number(paid.valor_cobrado), 15);
    await assert.rejects(() => book(1, "12:00", "plano", "22000000002"), /pagamento do plano/);
    flows += 2;
  });
  await asRole("authenticated", admin, async () => {
    await db.query("select public.desativar_bloqueio($1)", [block]);
    assert.equal((await db.query("select * from public.listar_bloqueios_painel()")).rows.length, 0);
    await db.query("select public.atualizar_status_agendamento($1,'cancelado')", [second.id]);
    flows += 2;
  });
  await asRole("anon", null, async () => {
    await book(1, "10:00");
    await book(2, "09:00");
    flows += 2;
  });
  console.log(`${flows} verificações de fluxos passaram com dados fictícios.`);
}

(async () => {
  try {
    console.log((await db.query("select version() as version")).rows[0].version);
    // Adaptador mínimo só para este banco em memória. Não substitui testes do Supabase Auth/HTTP.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth to anon, authenticated, service_role;
    `);
    await db.exec(migration);
    await verifyStructure();
    await verifyFlows();
    console.log("PASS: migração aplicada do zero, estrutura e fluxos validados em banco local descartável.");
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
