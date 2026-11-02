const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite();
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
const admin = "00000000-0000-4000-8000-000000000001";
const barber = "00000000-0000-4000-8000-000000000002";
const stranger = "00000000-0000-4000-8000-000000000003";
const inactive = "00000000-0000-4000-8000-000000000004";
let checks = 0,
  operation = 0,
  slot = 0;
const key = () =>
  "10000000-0000-4000-8000-" + String(++operation).padStart(12, "0");
async function asRole(role, uid, run) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    uid || "",
  ]);
  await db.exec("set role " + role);
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}
async function pay({
  phone = "22900000002",
  name = "Cliente teste",
  plan = 1,
  form = "pix",
  received = true,
  id = key(),
  uid = barber,
} = {}) {
  return asRole("authenticated", uid, async () => {
    const r = (
      await db.query(
        "select * from public.registrar_pagamento_plano($1,$2,$3,$4,$5,$6)",
        [name, phone, plan, form, received, id],
      )
    ).rows[0];
    return {
      ...r,
      data_inicio_vigencia: day(r.data_inicio_vigencia),
      data_fim_vigencia: day(r.data_fim_vigencia),
    };
  });
}
async function book(phone, date, category = "plano") {
  const n = slot++;
  const time =
    String(8 + Math.floor(n / 2)).padStart(2, "0") +
    ":" +
    (n % 2 ? "30" : "00");
  return asRole(
    "anon",
    null,
    async () =>
      (
        await db.query(
          "select * from public.criar_agendamento_com_resumo('Cliente teste',$1,1,1,$2::date,$3::time,$4)",
          [phone, date, time, category],
        )
      ).rows[0],
  );
}
async function conclude(id, extras = []) {
  return asRole(
    "authenticated",
    barber,
    async () =>
      (
        await db.query(
          "select public.concluir_agendamento_com_adicionais($1,$2::text[]) as pontos",
          [id, extras],
        )
      ).rows[0].pontos,
  );
}
async function counts() {
  return (
    await db.query(
      "select (select count(*) from public.clientes)::int as clientes,(select count(*) from public.assinaturas)::int as assinaturas,(select count(*) from public.pagamentos_planos)::int as pagamentos",
    )
  ).rows[0];
}
async function failsPay(options, re) {
  const before = await counts();
  await assert.rejects(() => pay(options), re);
  assert.deepEqual(await counts(), before);
  checks++;
}
(async () => {
  try {
    await db.exec(
      [
        "create role anon; create role authenticated; create role service_role bypassrls;",
        "create schema auth; create table auth.users(id uuid primary key);",
        "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
        "grant usage on schema auth to anon,authenticated,service_role;",
      ].join("\n"),
    );
    await db.exec(
      fs.readFileSync(
        path.join(root, "migrations/20261025000000_estrutura_inicial.sql"),
        "utf8",
      ),
    );
    await db.exec(
      fs.readFileSync(
        path.join(
          root,
          "migrations/20261031010000_conclusao_com_adicionais.sql",
        ),
        "utf8",
      ),
    );
    await db.exec(
      fs.readFileSync(
        path.join(
          root,
          "migrations/20261031020000_bloquear_conclusao_futura.sql",
        ),
        "utf8",
      ),
    );
    await db.exec(
      fs.readFileSync(
        path.join(root, "migrations/20261031000000_ranking_apenas_planos.sql"),
        "utf8",
      ),
    );
    for (const id of [admin, barber, stranger, inactive])
      await db.query("insert into auth.users values($1)", [id]);
    await db.exec(
      [
        "insert into public.barbeiros(nome) values ('A'),('B');",
        "insert into public.servicos(nome,duracao_minutos,preco,pontos) values ('Corte',30,30,40);",
        "insert into public.horarios_trabalho(barbeiro_id,dia_semana,horario_inicio,horario_fim) select b,d,'00:00'::time,'23:59'::time from generate_series(1,2)b cross join generate_series(0,6)d;",
        "insert into public.planos(nome,preco_mensal) values ('Essencial',60),('Clássico',79.90),('Premium',99.90);",
        "insert into public.plano_servicos(plano_id,servico_id,valor_desconto) values (1,1,30),(2,1,30),(3,1,30);",
        "insert into public.clientes(nome,telefone) values ('Legado fictício','+55 (22) 90000-0001');",
        "insert into public.assinaturas(cliente_id,plano_id,data_inicio,data_fim,status) values (1,1,'2026-10-02','2026-11-02','ativa');",
        "insert into public.pagamentos_planos(assinatura_id,valor_pago,mes_referencia,data_pagamento,status) values(1,60,'2026-10-01','2026-10-02 17:15:08.954906+00','pago');",
      ].join("\n"),
    );
    await db.query(
      "insert into public.perfis(usuario_id,nome,tipo,barbeiro_id,ativo) values($1,'Adm','admin',null,true),($2,'A','barbeiro',1,true),($3,'B','barbeiro',2,false)",
      [admin, barber, inactive],
    );
    const legacy = (
      await db.query("select * from public.assinaturas where id=1")
    ).rows[0];
    await db.exec(
      "insert into public.pagamentos_planos(assinatura_id,valor_pago,mes_referencia,status) values(1,60,'2026-09-01','pago')",
    );
    await assert.rejects(
      () =>
        db.exec(
          fs.readFileSync(
            path.join(
              root,
              "migrations/20261031030000_planos_vigencia_30_dias.sql",
            ),
            "utf8",
          ),
        ),
      /sem vigência conhecida/,
    );
    await db.exec("ROLLBACK");
    assert.equal(
      (
        await db.query(
          "select 1 from information_schema.columns where table_name='pagamentos_planos' and column_name='vigencia_inicio'",
        )
      ).rows.length,
      0,
    );
    checks++;
    await db.exec(
      "delete from public.pagamentos_planos where mes_referencia='2026-09-01'",
    );
    await db.exec(
      fs.readFileSync(
        path.join(
          root,
          "migrations/20261031030000_planos_vigencia_30_dias.sql",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      (await db.query("select * from public.assinaturas where id=1")).rows[0],
      legacy,
    );
    checks++;
    const legacyPayment = (
      await db.query("select * from public.pagamentos_planos where id=1")
    ).rows[0];
    assert.equal(day(legacyPayment.vigencia_inicio), "2026-10-02");
    assert.equal(day(legacyPayment.vigencia_fim), "2026-11-02");
    assert.equal(Number(legacyPayment.valor_pago), 60);
    checks++;
    const legacyCover = (
      await db.query(
        "select date '2026-11-01' between vigencia_inicio and vigencia_fim as coberto from public.pagamentos_planos where id=1",
      )
    ).rows[0];
    assert.equal(legacyCover.coberto, true);
    checks++;
    const calendar = (
      await db.query(
        "select (date '2026-10-31'+29)::text as outubro,(date '2028-02-01'+29)::text as bissexto,(date '2027-02-01'+29)::text as fevereiro,(date '2026-12-15'+29)::text as virada",
      )
    ).rows[0];
    assert.deepEqual(calendar, {
      outubro: "2026-11-29",
      bissexto: "2028-03-01",
      fevereiro: "2027-03-02",
      virada: "2027-01-13",
    });
    checks++;
    const plans = await asRole("authenticated", barber, () =>
      db.query("select * from public.listar_planos_painel()"),
    );
    assert.deepEqual(
      plans.rows.map((r) => Number(r.preco_mensal)),
      [60, 79.9, 99.9],
    );
    checks++;
    await asRole("anon", null, async () =>
      assert.rejects(
        () => db.query("select * from public.listar_planos_painel()"),
        /permission denied/,
      ),
    );
    checks++;
    assert.equal(
      (
        await asRole("authenticated", stranger, () =>
          db.query("select * from public.listar_planos_painel()"),
        )
      ).rows.length,
      0,
    );
    checks++;
    const today = (
      await db.query(
        "select timezone('America/Sao_Paulo',now())::date::text as hoje",
      )
    ).rows[0].hoje;
    const expectedEnd = (
      await db.query("select ($1::date+29)::text as fim", [today])
    ).rows[0].fim;
    const initialKey = key();
    const initial = await pay({ id: initialKey });
    assert.equal(initial.data_inicio_vigencia, today);
    assert.equal(initial.data_fim_vigencia, expectedEnd);
    assert.equal(Number(initial.valor_pago), 60);
    assert.equal(initial.renovacao_antecipada, false);
    checks++;
    const previous = await counts();
    const repeat = await pay({ phone: "+55 (22) 90000-0002", id: initialKey });
    assert.deepEqual(repeat, initial);
    assert.deepEqual(await counts(), previous);
    checks++;
    await db.exec("update public.planos set preco_mensal=61 where id=1");
    assert.equal(Number((await pay({ id: initialKey })).valor_pago), 60);
    checks++;
    await db.exec("update public.planos set preco_mensal=60 where id=1");
    const renewal = await pay();
    assert.equal(String(renewal.assinatura_id), String(initial.assinatura_id));
    const renewalDates = (
      await db.query(
        "select ($1::date+1)::text as inicio,($1::date+30)::text as fim",
        [expectedEnd],
      )
    ).rows[0];
    assert.equal(renewal.data_inicio_vigencia, renewalDates.inicio);
    assert.equal(renewal.data_fim_vigencia, renewalDates.fim);
    assert.equal(renewal.renovacao_antecipada, true);
    checks++;
    const secondRenewal = await pay();
    assert.equal(
      (
        await db.query(
          "select (data_fim-data_inicio+1)::int as dias from public.assinaturas where id=$1",
          [secondRenewal.assinatura_id],
        )
      ).rows[0].dias,
      90,
    );
    checks++;
    const originalPeriod = (
      await db.query(
        "select vigencia_inicio,vigencia_fim from public.pagamentos_planos where id=$1",
        [initial.pagamento_id],
      )
    ).rows[0];
    assert.deepEqual(
      {
        vigencia_inicio: day(originalPeriod.vigencia_inicio),
        vigencia_fim: day(originalPeriod.vigencia_fim),
      },
      { vigencia_inicio: today, vigencia_fim: expectedEnd },
    );
    checks++;
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*) as n from public.pagamentos_planos where assinatura_id=$1 and mes_referencia=date_trunc('month',$2::date::timestamp)::date",
            [initial.assinatura_id, today],
          )
        ).rows[0].n,
      ),
      3,
    );
    checks++;
    const nextMonth = (
      await db.query(
        "select (date_trunc('month',$1::date::timestamp)+interval '1 month')::date::text as dia",
        [today],
      )
    ).rows[0].dia;
    const crossing = await book("+55 (22) 90000-0002", nextMonth);
    assert.equal(Number(crossing.valor_cobrado), 0);
    checks++;
    await db.query(
      "update public.pagamentos_planos set mes_referencia=date_trunc('month',timezone('America/Sao_Paulo',now())-interval '1 month')::date,data_pagamento=now()-interval '1 month' where id=$1",
      [initial.pagamento_id],
    );
    const current = await book(
      "22900000002",
      (await db.query("select ($1::date+1)::text as dia", [today])).rows[0].dia,
    );
    await db.query("update public.agendamentos set data=$1::date where id=$2", [
      today,
      current.id,
    ]);
    assert.equal(Number(await conclude(current.id, ["pezinho"])), 50);
    checks++;
    await failsPay({ received: false }, /Confirme/);
    await failsPay({ id: null }, /Identificação/);
    await failsPay({ phone: "123" }, /DDD/);
    await failsPay({ plan: 999 }, /inválido/);
    await failsPay({ plan: 2 }, /outro plano vigente/);
    await failsPay({ uid: stranger }, /não autorizado/);
    await failsPay({ uid: inactive }, /não autorizado/);
    await failsPay({ id: initialKey, phone: "22900000009" }, /outra operação/);
    await failsPay({ id: initialKey, form: "dinheiro" }, /outra operação/);
    await failsPay({ id: initialKey, uid: admin }, /outra operação/);
    const admPay = await pay({ phone: "22900000003", uid: admin, plan: 2 });
    assert.equal(Number(admPay.valor_pago), 79.9);
    checks++;
    const expiredStart = await pay({ phone: "22900000004" });
    await db.query(
      "update public.assinaturas set data_inicio=$1::date-60,data_fim=$1::date-1 where id=$2",
      [today, expiredStart.assinatura_id],
    );
    const afterExpiry = await pay({ phone: "22900000004" });
    assert.notEqual(
      String(afterExpiry.assinatura_id),
      String(expiredStart.assinatura_id),
    );
    assert.equal(afterExpiry.data_inicio_vigencia, today);
    assert.equal(afterExpiry.data_fim_vigencia, expectedEnd);
    assert.equal(
      (
        await db.query("select status from public.assinaturas where id=$1", [
          expiredStart.assinatura_id,
        ])
      ).rows[0].status,
      "expirada",
    );
    checks++;
    await db.query(
      "update public.pagamentos_planos set status='estornado' where id=$1",
      [initial.pagamento_id],
    );
    await failsPay({}, /sem pagamento válido/);
    await assert.rejects(() => book("22900000002", nextMonth), /não cobre/);
    checks++;
    const denied = await book("22900000002", renewal.data_inicio_vigencia);
    await db.query("update public.agendamentos set data=$1::date where id=$2", [
      today,
      denied.id,
    ]);
    await assert.rejects(() => conclude(denied.id, []), /Plano sem vigência/);
    checks++;
    await db.query(
      "update public.pagamentos_planos set status='pago' where id=$1",
      [initial.pagamento_id],
    );
    const receipt = (
      await db.query(
        "select registrado_por,chave_operacao from public.pagamentos_planos where id=$1",
        [initial.pagamento_id],
      )
    ).rows[0];
    assert.equal(receipt.registrado_por, barber);
    assert.equal(receipt.chave_operacao, initialKey);
    checks++;
    const dupPhone = "22900000005";
    await db.query(
      "insert into public.clientes(nome,telefone) values('Duplicado A',$1),('Duplicado B',$2)",
      [dupPhone, "+55 " + dupPhone],
    );
    await failsPay({ phone: dupPhone }, /mais de um cadastro/);
    await assert.rejects(
      () =>
        db.exec(
          "insert into public.pagamentos_planos(assinatura_id,valor_pago,mes_referencia,status) values(1,60,current_date,'pago')",
        ),
      /pagamentos_confirmados_com_vigencia/,
    );
    checks++;
    const stable = (
      await db.query(
        "select id,assinatura_id,valor_pago,vigencia_inicio,vigencia_fim from public.pagamentos_planos order by id",
      )
    ).rows;
    await db.exec(
      fs.readFileSync(
        path.join(
          root,
          "migrations/20261031030000_planos_vigencia_30_dias.sql",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      (
        await db.query(
          "select id,assinatura_id,valor_pago,vigencia_inicio,vigencia_fim from public.pagamentos_planos order by id",
        )
      ).rows,
      stable,
    );
    checks++;
    console.log(
      "PASS: " +
        checks +
        " verificações locais de vigência, migração, renovação, repetição, telefone, permissões e virada do mês.",
    );
    console.log("Data de negócio no teste: " + today);
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
