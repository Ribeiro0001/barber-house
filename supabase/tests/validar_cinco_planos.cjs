const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const admin='00000000-0000-4000-8000-000000000001';
const barber='00000000-0000-4000-8000-000000000002';
const originalFiles=['20261025000000_estrutura_inicial.sql','20261031000000_ranking_apenas_planos.sql','20261031010000_conclusao_com_adicionais.sql','20261031020000_bloquear_conclusao_futura.sql','20261031030000_planos_vigencia_30_dias.sql'];
const pointMigration=fs.readFileSync(path.join(root,'migrations/20261102000000_pontos_por_cobertura.sql'),'utf8');
const catalogMigration=fs.readFileSync(path.join(root,'migrations/20261102010000_catalogo_cinco_planos.sql'),'utf8');
const installer=fs.readFileSync(path.join(root,'consultas/aplicar_cinco_planos.sql'),'utf8');
const catalog=[
  {code:'cabelo',name:'Cabelo',price:59.9,cover:['corte']},
  {code:'cabelo_barba',name:'Cabelo e Barba',price:89.9,cover:['corte','barba']},
  {code:'cabelo_sobrancelha',name:'Cabelo e Sobrancelha',price:79.9,cover:['corte','sobrancelha']},
  {code:'completo',name:'Cabelo, Barba e Sobrancelha',price:99.9,cover:['corte','barba','sobrancelha']},
  {code:'barba',name:'Barba',price:49.9,cover:['barba']},
];
const services=[
  {name:'Corte',price:30,parts:['corte']},
  {name:'Barba',price:20,parts:['barba']},
  {name:'Sobrancelha',price:10,parts:['sobrancelha']},
  {name:'Pezinho',price:10,parts:['pezinho']},
  {name:'Corte + Barba',price:50,parts:['corte','barba']},
  {name:'Corte + Sobrancelha',price:40,parts:['corte','sobrancelha']},
  {name:'Corte + Barba + Sobrancelha',price:60,parts:['corte','barba','sobrancelha']},
  {name:'Corte + Pigmentação',price:45,parts:['corte']},
];
let checks=0,operation=0,slot=0;
const points={corte:40,barba:20,sobrancelha:10,pezinho:10};
const prices={corte:30,barba:20,sobrancelha:10,pezinho:10};
const key=()=> '30000000-0000-4000-8000-'+String(++operation).padStart(12,'0');
async function role(db,name,uid,run){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
  await db.exec('set role '+name);
  try{return await run();}finally{await db.exec('reset role');}
}
async function pay(db,plan,phone,id=key()){
  return role(db,'authenticated',barber,async()=>(await db.query(
    "select * from public.registrar_pagamento_plano('Cliente teste',$1,$2,'pix',true,$3)",
    [phone,plan,id])).rows[0]);
}
async function setup(withPoints,seed=true){
  const db=new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated,service_role;");
  for(const f of originalFiles)await db.exec(fs.readFileSync(path.join(root,'migrations',f),'utf8'));
  if(seed){
    for(const id of [admin,barber])await db.query('insert into auth.users values($1)',[id]);
    await db.exec("insert into public.barbeiros(nome) values('A'); insert into public.horarios_trabalho(barbeiro_id,dia_semana,horario_inicio,horario_fim) select 1,d,'00:00'::time,'23:59'::time from generate_series(0,6)d;");
    await db.query("insert into public.perfis(usuario_id,nome,tipo,barbeiro_id,ativo) values($1,'Adm','admin',null,true),($2,'A','barbeiro',1,true)",[admin,barber]);
    await db.exec("insert into public.planos(nome,preco_mensal) values('Essencial',60),('Clássico',79.90),('Premium',99.90);");
    for(let i=0;i<services.length;i++){
      const s=services[i];
      await db.query('insert into public.servicos(nome,duracao_minutos,preco,pontos) values($1,30,$2,$3)',[
        s.name,(i===2||i===5)?0:s.price,i===7?0:s.parts.reduce((n,c)=>n+points[c],0)]);
    }
    await db.exec('insert into public.plano_servicos(plano_id,servico_id,valor_desconto) select p.id,s.id,case when s.id=1 then 30 else 0 end from public.planos p cross join public.servicos s;');
  }
  if(withPoints)await db.exec(pointMigration);
  return db;
}
async function snapshot(db){
  return {
    payments:(await db.query('select * from public.pagamentos_planos order by id')).rows,
    subscriptions:(await db.query('select * from public.assinaturas order by id')).rows,
  };
}
async function book(db,plan,phone,service,category='plano'){
  const n=slot++;
  const day=(await db.query("select (timezone('America/Sao_Paulo',now())::date+$1::integer)::text as dia",[1+Math.floor(n/20)])).rows[0].dia;
  const time=String(6+Math.floor((n%20)/2)).padStart(2,'0')+':'+(n%2?'30':'00');
  return role(db,'anon',null,async()=>(await db.query(
    "select * from public.criar_agendamento_com_resumo('Cliente teste',$1,1,$2,$3::date,$4::time,$5)",
    [phone,service,day,time,category])).rows[0]);
}
async function finish(db,id,extras=[]){
  await db.query("update public.agendamentos set data=timezone('America/Sao_Paulo',now())::date where id=$1",[id]);
  return role(db,'authenticated',barber,async()=>(await db.query(
    'select public.concluir_agendamento_com_adicionais($1,$2::text[]) as pontos',[id,extras])).rows[0].pontos);
}
async function expectAttendance(db,plan,phone,service,extras,expectedPoints,expectedAmount,category='plano'){
  const reservation=await book(db,plan,phone,service,category);
  assert.equal(Number(await finish(db,reservation.id,extras)),expectedPoints);
  const saved=(await db.query('select pontos_gerados,preco_cobrado from public.atendimentos where agendamento_id=$1',[reservation.id])).rows[0];
  assert.equal(Number(saved.pontos_gerados),expectedPoints);
  assert.equal(Number(saved.preco_cobrado),expectedAmount);
  checks++;
}
async function assertCatalog(db){
  const rows=(await db.query('select id,codigo,nome,preco_mensal,componentes_incluidos,ativo from public.planos where ativo')).rows;
  assert.equal(rows.length,5);
  for(const p of catalog){
    const saved=rows.find(r=>r.codigo===p.code);
    assert(saved);
    assert.equal(saved.nome,p.name);
    assert.equal(Number(saved.preco_mensal),p.price);
    assert.deepEqual(saved.componentes_incluidos,p.cover);
  }
  checks++;
  return Object.fromEntries(rows.map(r=>[r.codigo,r]));
}
(async()=>{
  const db=await setup(true);
  try{
    const legacyKey=key();
    await pay(db,1,'22900000101',legacyKey);
    await pay(db,2,'22900000102');
    const legacy=await book(db,1,'22900000101',1);
    await finish(db,legacy.id,['pezinho']);
    const before=await snapshot(db);
    const history=(await db.query('select * from public.atendimentos where agendamento_id=$1',[legacy.id])).rows[0];
    await db.exec(catalogMigration);
    const plans=await assertCatalog(db);
    assert.equal(plans.cabelo.id,1);
    assert.equal(plans.cabelo_sobrancelha.id,2);
    assert.equal(plans.completo.id,3); checks++;
    assert.deepEqual(await snapshot(db),before); checks++;
    assert.deepEqual((await db.query('select * from public.atendimentos where agendamento_id=$1',[legacy.id])).rows[0],history); checks++;
    assert.equal(Number((await pay(db,1,'22900000101',legacyKey)).valor_pago),60); checks++;
    const renewal=await pay(db,1,'22900000101');
    assert.equal(Number(renewal.valor_pago),59.9);
    assert.equal(renewal.renovacao_antecipada,true); checks++;
    assert.equal(Number((await db.query("select preco from public.servicos where nome='Sobrancelha'")).rows[0].preco),10); checks++;
    const phones={};
    for(let i=0;i<catalog.length;i++){
      const p=catalog[i];
      const phone='2290000020'+String(i);
      phones[p.code]=phone;
      const payment=await pay(db,plans[p.code].id,phone);
      assert.equal(Number(payment.valor_pago),p.price);
      const period=(await db.query('select (vigencia_fim-vigencia_inicio+1)::integer as dias from public.pagamentos_planos where id=$1',[payment.pagamento_id])).rows[0];
      assert.equal(period.dias,30);
      checks++;
    }
    for(const p of catalog){
      for(let s=0;s<services.length;s++){
        const service=services[s];
        const included=service.parts.filter(c=>p.cover.includes(c));
        const expectedPoints=included.reduce((n,c)=>n+points[c],0);
        const expectedAmount=Math.max(0,service.price-included.reduce((n,c)=>n+prices[c],0));
        await expectAttendance(db,plans[p.code].id,phones[p.code],s+1,[],expectedPoints,expectedAmount);
      }
      const all=['corte','barba','sobrancelha'];
      const expectedPoints=all.filter(c=>p.cover.includes(c)).reduce((n,c)=>n+points[c],0);
      const expectedAmount=all.filter(c=>!p.cover.includes(c)).reduce((n,c)=>n+prices[c],0);
      await expectAttendance(db,plans[p.code].id,phones[p.code],1,['barba','sobrancelha'],expectedPoints,expectedAmount);
      await expectAttendance(db,plans[p.code].id,phones[p.code],1,['barba','sobrancelha'],0,60,'avulso');
    }
    const visible=(await role(db,'authenticated',barber,()=>db.query('select * from public.listar_planos_painel()'))).rows;
    assert.equal(visible.length,5);
    assert.deepEqual(visible.map(r=>Number(r.preco_mensal)),[49.9,59.9,79.9,89.9,99.9]); checks++;
    await role(db,'anon',null,()=>assert.rejects(()=>db.query('select * from public.listar_planos_painel()'),/permission denied/)); checks++;
    const unchanged=await snapshot(db);
    const ids=Object.fromEntries(Object.entries(plans).map(([code,row])=>[code,row.id]));
    await db.exec(installer);
    const repeated=await assertCatalog(db);
    assert.deepEqual(Object.fromEntries(Object.entries(repeated).map(([code,row])=>[code,row.id])),ids);
    assert.deepEqual(await snapshot(db),unchanged); checks++;
    await db.exec("insert into public.planos(nome,preco_mensal,componentes_incluidos) values('Plano Extra',123,ARRAY['corte'])");
    const withExtra=await snapshot(db);
    await assert.rejects(()=>db.exec(installer),/plano ativo não identificado/);
    await db.exec('rollback');
    assert.deepEqual(await snapshot(db),withExtra);
    assert.equal((await db.query("select count(*)::int as n from public.planos where nome='Cabelo'")).rows[0].n,1); checks++;
    await db.exec("delete from public.planos where nome='Plano Extra'");
    await db.exec("insert into public.planos(nome,preco_mensal,componentes_incluidos) values('Essencial',60,ARRAY['corte'])");
    await assert.rejects(()=>db.exec(installer),/duplicate|duplicad|mesma cobertura/);
    await db.exec('rollback'); checks++;
    await db.exec("delete from public.planos where nome='Essencial'");

    const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');
    const cards=[...html.matchAll(/data-plano-codigo="([^"]+)"[\s\S]*?<h3>Plano ([^<]+)<\/h3>[\s\S]*?<p class="preco-plano">R\$ ([0-9,]+) \/ 30 dias<\/p>/g)];
    assert.equal(cards.length,5);
    for(const p of catalog){
      const card=cards.find(c=>c[1]===p.code);
      assert(card);
      assert.equal(card[2],p.name);
      assert.equal(card[3],p.price.toFixed(2).replace('.',','));
    }
    checks++;

    const source=fs.readFileSync(path.resolve(__dirname,'../../js/planos.js'),'utf8');
    const code=source.slice(source.indexOf('async function carregarPlanosPainel()'),source.indexOf('function formatarDataPlano('));
    const select={options:[],set innerHTML(value){this.options=[{value:'',textContent:'Selecione o plano'}];},appendChild(option){this.options.push(option);}};
    let prepared=0;
    const context={
      salvandoPlano:false,registroPlanoPreparado:false,
      atualizarBotaoPlano(){},mensagemPlano:{textContent:''},resumoPlano:{textContent:''},
      selectPlanoCliente:select,moedaPlano:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
      document:{createElement:()=>({dataset:{}})},
      prepararRegistroPlano:async()=>{prepared++;},
      clienteSupabase:{rpc:async name=>{assert.equal(name,'listar_planos_painel');return{data:visible,error:null};}},
      console:{error(){}},
    };
    vm.runInNewContext(code,context);
    await context.carregarPlanosPainel();
    assert.equal(select.options.length,6);
    assert.equal(prepared,1);
    for(const p of catalog){
      const option=select.options.find(o=>String(o.value)===String(plans[p.code].id));
      assert(option.textContent.includes(p.name));
      assert(option.textContent.includes(p.price.toFixed(2).replace('.',',')));
    }
    checks++;
  } finally {await db.close();}

  const original=await setup(false);
  try{
    await pay(original,1,'22900000301');
    const before=await snapshot(original);
    await original.exec(installer);
    await assertCatalog(original);
    assert.deepEqual(await snapshot(original),before); checks++;
  }finally{await original.close();}
  const renamed=await setup(false);
  try{
    await renamed.exec("update public.planos set nome=case id when 1 then 'Cabelo' when 2 then 'Cabelo e Sobrancelha' else 'Cabelo, Barba e Sobrancelha' end; insert into public.planos(nome,preco_mensal) values('Cabelo e Barba',89.90),('Barba',49.90);");
    await renamed.exec(installer);
    const rows=await assertCatalog(renamed);
    assert.equal(rows.cabelo.id,1);
    assert.equal(rows.cabelo_sobrancelha.id,2);
    assert.equal(rows.completo.id,3); checks++;
  }finally{await renamed.close();}
  const empty=await setup(false,false);
  try{
    await empty.exec(pointMigration);
    await empty.exec(catalogMigration);
    await assertCatalog(empty);
  }finally{await empty.close();}
  console.log('PASS: '+checks+' verificações dos cinco planos, cobranças, pontos, catálogo público, seletor e instalação.');
})().catch(error=>{console.error(error);process.exitCode=1;});

