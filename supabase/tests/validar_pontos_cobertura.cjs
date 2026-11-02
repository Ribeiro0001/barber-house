const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
const db = new PGlite();
const root = path.resolve(__dirname,'../migrations');
const admin='00000000-0000-4000-8000-000000000001';
const barber='00000000-0000-4000-8000-000000000002';
const other='00000000-0000-4000-8000-000000000003';
const inactive='00000000-0000-4000-8000-000000000004';
let checks=0,slot=0,operation=0;
const key=()=>`20000000-0000-4000-8000-${String(++operation).padStart(12,'0')}`;
const phones={1:'22900000001',2:'22900000002',3:'22900000003'};
async function role(name,uid,run){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
  await db.exec('set role '+name);
  try{return await run();}finally{await db.exec('reset role');}
}
async function pay(plan){
  return role('authenticated',barber,async()=>(await db.query(
    "select * from public.registrar_pagamento_plano('Cliente teste',$1,$2,'pix',true,$3)",
    [phones[plan],plan,key()])).rows[0]);
}
async function book(plan,service,category='plano'){
  const n=slot++;
  const date=(await db.query("select (timezone('America/Sao_Paulo',now())::date+$1::integer)::text as dia",[1+Math.floor(n/20)])).rows[0].dia;
  const time=String(6+Math.floor((n%20)/2)).padStart(2,'0')+':' +(n%2?'30':'00');
  return role('anon',null,async()=>(await db.query(
    "select * from public.criar_agendamento_com_resumo('Cliente teste',$1,1,$2,$3::date,$4::time,$5)",
    [phones[plan],service,date,time,category])).rows[0]);
}
async function today(id){
  await db.query("update public.agendamentos set data=timezone('America/Sao_Paulo',now())::date where id=$1",[id]);
}
async function finish(id,extras=[],uid=barber){
  return role('authenticated',uid,async()=>(await db.query(
    'select public.concluir_agendamento_com_adicionais($1,$2::text[]) as pontos',[id,extras])).rows[0].pontos);
}
async function attendance(id){
  return (await db.query('select pontos_gerados,preco_cobrado,adicionais from public.atendimentos where agendamento_id=$1',[id])).rows[0];
}
async function scenario(plan,service,extras,points,amount,category='plano'){
  const item=await book(plan,service,category);
  await today(item.id);
  assert.equal(Number(await finish(item.id,extras)),points);
  const saved=await attendance(item.id);
  assert.equal(Number(saved.pontos_gerados),points);
  assert.equal(Number(saved.preco_cobrado),amount);
  assert.deepEqual(saved.adicionais,extras);
  checks++;
  return item;
}

(async()=>{
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated,service_role;");
    for(const name of ['20261025000000_estrutura_inicial.sql','20261031000000_ranking_apenas_planos.sql','20261031010000_conclusao_com_adicionais.sql','20261031020000_bloquear_conclusao_futura.sql','20261031030000_planos_vigencia_30_dias.sql']){
      await db.exec(fs.readFileSync(path.join(root,name),'utf8'));
    }
    for(const uid of [admin,barber,other,inactive]) await db.query('insert into auth.users values($1)',[uid]);
    await db.exec("insert into public.barbeiros(nome) values('A'),('B'),('C'); insert into public.horarios_trabalho(barbeiro_id,dia_semana,horario_inicio,horario_fim) select b,d,'00:00'::time,'23:59'::time from generate_series(1,3)b cross join generate_series(0,6)d;");
    await db.query("insert into public.perfis(usuario_id,nome,tipo,barbeiro_id,ativo) values($1,'Adm','admin',null,true),($2,'A','barbeiro',1,true),($3,'B','barbeiro',2,true),($4,'C','barbeiro',3,false)",[admin,barber,other,inactive]);
    await db.exec("insert into public.planos(nome,preco_mensal) values('Essencial',60),('Clássico',79.90),('Premium',99.90);");
    const services=[['Corte',30,40],['Barba',20,20],['Sobrancelha',0,10],['Pezinho',10,10],['Corte + Barba',50,60],['Corte + Sobrancelha',0,50],['Corte + Barba + Sobrancelha',60,70],['Corte + Pigmentação',45,0],['Barba + Pigmentação',30,0],['Corte + Barba + Pigmentação',60,0],['Corte + Barba + Sobrancelha + Pigmentação',70,0]];
    for(const [nome,preco,pontos] of services) await db.query('insert into public.servicos(nome,duracao_minutos,preco,pontos) values($1,30,$2,$3)',[nome,preco,pontos]);
    await db.exec('insert into public.plano_servicos(plano_id,servico_id,valor_desconto) select p.id,s.id,case when s.id=1 then 30 else 0 end from public.planos p cross join public.servicos s;');
    for(const plan of [1,2,3]) await pay(plan);
    const legacy=await book(1,1);
    await today(legacy.id);
    assert.equal(Number(await finish(legacy.id,['pezinho'])),50);
    const legacyBefore=await attendance(legacy.id);
    const migration=fs.readFileSync(path.join(root,'20261102000000_pontos_por_cobertura.sql'),'utf8');
    await db.exec("insert into public.planos(nome,preco_mensal) values('Desconhecido',123)");
    await assert.rejects(()=>db.exec(migration),/sem cobertura configurada/);
    await db.exec('rollback');
    assert.equal(Number((await db.query('select preco from public.servicos where id=3')).rows[0].preco),0);
    await db.exec("delete from public.planos where nome='Desconhecido'"); checks++;
    await db.exec(migration);
    assert.deepEqual(await attendance(legacy.id),legacyBefore); checks++;
    const catalog=(await db.query('select id,preco,pontos from public.servicos where id in (3,6,8,9,10,11) order by id')).rows;
    assert.equal(Number(catalog[0].preco),10);
    assert.equal(Number(catalog[1].preco),40);
    assert.deepEqual(catalog.slice(2).map(r=>r.pontos),[40,20,60,70]); checks++;
    assert.deepEqual((await db.query('select componentes_incluidos from public.planos order by id')).rows.map(r=>r.componentes_incluidos),[['corte'],['corte','barba'],['corte','barba','sobrancelha']]); checks++;
    assert.deepEqual((await db.query('select preco_mensal from public.planos order by id')).rows.map(r=>Number(r.preco_mensal)),[60,79.9,99.9]); checks++;

    await scenario(1,1,[],40,0);
    await scenario(1,5,[],40,20);
    await scenario(1,7,[],40,30);
    await scenario(1,1,['barba','sobrancelha'],40,30);
    await scenario(1,1,['pezinho'],40,10);
    await scenario(1,2,[],0,20);
    await scenario(1,3,[],0,10);
    await scenario(1,4,[],0,10);
    await scenario(1,6,[],40,10);
    await scenario(2,1,[],40,0);
    await scenario(2,5,[],60,0);
    await scenario(2,1,['barba'],60,0);
    await scenario(2,7,[],60,10);
    await scenario(2,1,['barba','sobrancelha'],60,10);
    await scenario(2,3,[],0,10);
    await scenario(3,7,[],70,0);
    await scenario(3,1,['barba','sobrancelha'],70,0);
    await scenario(3,2,[],20,0);
    await scenario(3,3,[],10,0);
    await scenario(3,6,[],50,0);
    await scenario(3,1,['pezinho'],40,10);
    await scenario(1,8,[],40,15);
    await scenario(2,10,[],60,10);
    await scenario(3,11,[],70,10);
    await scenario(3,9,[],20,10);
    await scenario(3,7,[],0,60,'avulso');
    await scenario(3,1,['barba','sobrancelha'],0,60,'avulso');
    await scenario(3,3,[],0,10,'avulso');

    const preview=await book(1,5);
    const visible=await role('authenticated',barber,()=>db.query('select * from public.listar_agendamentos_painel_v2() where id=$1',[preview.id]));
    assert.equal(visible.rows[0].pontos_gerados,40);
    assert.deepEqual(visible.rows[0].componentes_cobertos,['corte']);
    assert.deepEqual(visible.rows[0].precos_adicionais,{barba:20,pezinho:10,sobrancelha:10}); checks++;
    await role('anon',null,()=>assert.rejects(()=>db.query('select * from public.listar_agendamentos_painel_v2()'),/permission denied/)); checks++;
    assert.equal((await role('authenticated',other,()=>db.query('select * from public.listar_agendamentos_painel_v2()'))).rows.length,0); checks++;
    assert.equal((await role('authenticated',inactive,()=>db.query('select * from public.listar_agendamentos_painel_v2()'))).rows.length,0); checks++;
    await role('authenticated',barber,()=>assert.rejects(()=>db.query("select public.pontos_cobertos_do_servico(1,3,'{}')"),/permission denied/)); checks++;
    await assert.rejects(()=>finish(preview.id,[],other),/pertence a outro/); checks++;
    await assert.rejects(()=>finish(preview.id),/futur|data|conclu/i); checks++;
    await today(preview.id);
    await assert.rejects(()=>finish(preview.id,['barba']),/já faz parte/); checks++;
    await assert.rejects(()=>finish(preview.id,['pezinho','pezinho']),/inválida ou repetida/); checks++;
    await db.query('update public.agendamentos set pontos_gerados=9999 where id=$1',[preview.id]);
    assert.equal(Number(await finish(preview.id)),40); checks++;
    await assert.rejects(()=>finish(preview.id),/já finalizado/); checks++;

    const unpaid=await book(2,1);
    await today(unpaid.id);
    await db.exec('update public.pagamentos_planos set status=\'estornado\' where assinatura_id in (select id from public.assinaturas where plano_id=2)');
    await assert.rejects(()=>finish(unpaid.id,['barba']),/Plano sem vigência/);
    assert.equal(await attendance(unpaid.id),undefined); checks++;
    await db.exec('update public.pagamentos_planos set status=\'pago\' where assinatura_id in (select id from public.assinaturas where plano_id=2)');
    const beforeRefund=(await db.query('select status,pontos_gerados,preco_cobrado from public.agendamentos where id=$1',[unpaid.id])).rows[0];
    await db.exec('update public.servicos set ativo=false where id=3');
    await assert.rejects(()=>finish(unpaid.id,['sobrancelha']),/Preço não configurado/);
    assert.deepEqual((await db.query('select status,pontos_gerados,preco_cobrado from public.agendamentos where id=$1',[unpaid.id])).rows[0],beforeRefund); checks++;
    await db.exec('update public.servicos set ativo=true where id=3');
    const classic=await book(2,3);
    assert.equal(Number(classic.valor_cobrado),10);
    assert.equal(Number(classic.valor_desconto),0); checks++;
    const essential=await book(1,5);
    assert.equal(Number(essential.valor_cobrado),20); checks++;
    const classicHairBeard=await book(2,5);
    assert.equal(Number(classicHairBeard.valor_cobrado),0); checks++;
    const paidPrices=(await db.query('select valor_pago from public.pagamentos_planos order by id')).rows.map(r=>Number(r.valor_pago));
    assert.deepEqual(paidPrices,[60,79.9,99.9]); checks++;
    await db.exec(migration);
    assert.deepEqual(await attendance(legacy.id),legacyBefore); checks++;

    const empty=new PGlite();
    try {
      await empty.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated,service_role;");
      for(const name of ['20261025000000_estrutura_inicial.sql','20261031000000_ranking_apenas_planos.sql','20261031010000_conclusao_com_adicionais.sql','20261031020000_bloquear_conclusao_futura.sql','20261031030000_planos_vigencia_30_dias.sql']) {
        await empty.exec(fs.readFileSync(path.join(root,name),'utf8'));
      }
      await empty.exec(migration); checks++;
      await empty.exec("insert into public.planos(nome,preco_mensal) values('Premium',99.90); insert into public.servicos(nome,duracao_minutos,preco,pontos) values('Corte',30,30,40),('Barba',30,20,20),('Sobrancelha',30,10,10);");
      assert.deepEqual((await empty.query('select componentes_incluidos from public.planos')).rows[0].componentes_incluidos,['corte','barba','sobrancelha']);
      assert.equal(Number((await empty.query('select public.desconto_coberto_do_servico(1,1) as valor')).rows[0].valor),30); checks++;
    } finally {await empty.close();}
    console.log('PASS: '+checks+' verificações locais de pontos cobertos, preços, adicionais, permissões e histórico.');

    const vm=require('node:vm');
    const front=fs.readFileSync(path.resolve(__dirname,'../../js/agenda.js'),'utf8');
    const calc=front.slice(front.indexOf('function atualizarPontosConclusao()'),front.indexOf('function abrirConclusao('));
    let previews=0;
    function previewCase(appointment,fields,points,amount){
      const context={
        agendamentoEmConclusao:appointment,
        camposAdicionais:fields,
        pontosAdicionais:{pezinho:10,barba:20,sobrancelha:10},
        pontosConclusao:{textContent:''},
      };
      vm.runInNewContext(calc+'\natualizarPontosConclusao();',context);
      assert.match(context.pontosConclusao.textContent,new RegExp('(?:Pontos do plano: |avulso: )'+points));
      const pricePattern = amount === 'não configurado'
        ? new RegExp(amount)
        : new RegExp('R\\$\\s*'+amount+'$');
      assert.match(context.pontosConclusao.textContent,pricePattern);
      previews++;
    }
    const base={categoria:'plano',pontos:40,preco:0,componentesCobertos:['corte'],precosAdicionais:{barba:20,sobrancelha:10,pezinho:10}};
    const selected=value=>({value,checked:true,disabled:false});
    previewCase(base,[selected('sobrancelha')],40,'10,00');
    previewCase(base,[selected('barba'),selected('sobrancelha')],40,'30,00');
    previewCase({...base,componentesCobertos:['corte','barba'],precosAdicionais:{barba:0,sobrancelha:10}},[selected('barba')],60,'0,00');
    previewCase({...base,componentesCobertos:['corte','barba','sobrancelha'],precosAdicionais:{barba:0,sobrancelha:0}},[selected('barba'),selected('sobrancelha')],70,'0,00');
    previewCase({...base,categoria:'avulso',preco:30},[selected('barba'),selected('sobrancelha')],0,'60,00');
    previewCase({...base,pontos:60},[{value:'barba',checked:true,disabled:true}],60,'0,00');
    previewCase({...base,precosAdicionais:{sobrancelha:null}},[selected('sobrancelha')],40,'não configurado');
    console.log('PASS: '+previews+' prévias do formulário com a função JavaScript real.');
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
