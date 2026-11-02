const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../../js/agenda.js"), "utf8")
  .replace(/\niniciarAgenda\(\);\s*$/, "\n");

function app(tipo = "admin") {
  class Element {
    constructor(tag = "div", id = "") {
      this.tagName = tag;
      this.id = id;
      this.children = [];
      this.listeners = {};
      this.dataset = {};
      this.attributes = {};
      this.checked = false;
      this.disabled = false;
      this.hidden = false;
      this.required = false;
      this._value = "";
      this._text = "";
      const classes = new Set();
      this.classList = { add: (...names) => names.forEach(n => classes.add(n)), contains: n => classes.has(n) };
    }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(""); }
    set innerHTML(value) { this.children = []; this._text = ""; this.value = ""; }
    get options() { return this.children; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    append(...children) { children.forEach(c => this.appendChild(c)); }
    replaceChildren(...children) { this.children = []; this._text = ""; this.append(...children); }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    closest() { return this.wrapper ||= new Element(); }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const ids = ["filtro-data","filtro-barbeiro","resumo-agenda","lista-agendamentos",
    "filtro-status","lista-ranking","form-bloqueio","bloqueio-barbeiro","campo-bloqueio-barbeiro",
    "bloqueio-data","bloqueio-dia-inteiro","bloqueio-inicio","bloqueio-fim","bloqueio-motivo",
    "mensagem-bloqueio","lista-bloqueios","salvar-bloqueio","atualizar-bloqueios","botao-sair",
    "modal-conclusao","form-conclusao","servico-base-conclusao","pontos-conclusao",
    "mensagem-conclusao","cancelar-conclusao","confirmar-conclusao"];
  const fields = Object.fromEntries(ids.map(id => [id, new Element("div", id)]));
  const horarios = [new Element(),new Element()];
  const adicionais = ["pezinho","barba","sobrancelha"].map(value => {
    const el = new Element("input"); el.value = value; return el;
  });
  const controles = ["bloqueio-barbeiro","bloqueio-data","bloqueio-dia-inteiro",
    "bloqueio-inicio","bloqueio-fim","bloqueio-motivo"].map(id => fields[id]);
  const state = { calls: [], rows: [], valid: true, perfil: { nome:"Lucas",tipo,barbeiro_id:1,ativo:true }, plans:0 };
  fields["form-conclusao"].querySelectorAll = () => adicionais;
  fields["form-bloqueio"].querySelectorAll = selector =>
    selector === ".campo-horario-bloqueio" ? horarios : controles;
  fields["form-bloqueio"].reportValidity = () => state.valid;
  fields["form-bloqueio"].reset = () => controles.forEach(el => { el.value = ""; el.checked = false; });
  const query = {
    select() { return query; }, eq() { return query; },
    async single() { return {data:state.perfil,error:null}; },
    async order() { return {data:[{id:1,nome:"Lucas"},{id:2,nome:"Matheus"}],error:null}; }
  };
  state.listar = async () => ({data:state.rows,error:null});
  state.criar = async p => {
    const id = 50;
    state.rows.push({id,barbeiro_id:p.p_barbeiro_id,barbeiro_nome:"Lucas",data:p.p_data,
      dia_inteiro:p.p_dia_inteiro,horario_inicio:p.p_horario_inicio,horario_fim:p.p_horario_fim,motivo:p.p_motivo});
    return {data:id,error:null};
  };
  state.remover = async p => {
    state.rows = state.rows.filter(row => row.id !== p.p_bloqueio_id);
    return {data:p.p_bloqueio_id,error:null};
  };
  const context = {
    document: {getElementById:id => fields[id],createElement:tag => new Element(tag)},
    window: {location:{replace() {}}},
    console: {log() {},error() {}},
    carregarPlanosPainel: async () => { state.plans++; },
    clienteSupabase: {
      auth: {getSession: async () => ({data:{session:{user:{id:"teste"}}},error:null}), signOut: async () => ({error:null})},
      from: () => query,
      rpc: async (name,payload) => {
        state.calls.push({name,payload});
        if(name === "listar_bloqueios_painel") return state.listar(payload);
        if(name === "criar_bloqueio") return state.criar(payload);
        if(name === "desativar_bloqueio") return state.remover(payload);
        if(name === "listar_agendamentos_painel_v2" && state.failAgenda) throw new Error("offline");
        return {data:[],error:null};
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  const submit = () => fields["form-bloqueio"].listeners.submit[0]({preventDefault() {}});
  const fill = () => {
    fields["bloqueio-barbeiro"].value = "1";
    fields["bloqueio-data"].value = "2026-11-03";
    fields["bloqueio-inicio"].value = "14:00";
    fields["bloqueio-fim"].value = "15:00";
    fields["bloqueio-motivo"].value = "  Compromisso  ";
  };
  return {context,fields,state,horarios,submit,fill};
}

const row = {id:8,barbeiro_id:1,barbeiro_nome:"Lucas",data:"2026-11-03",
  dia_inteiro:false,horario_inicio:"14:00:00",horario_fim:"15:00:00",motivo:"Compromisso"};
const count = (a,name) => a.state.calls.filter(c => c.name === name).length;
const start = async tipo => { const a = app(tipo); await a.context.iniciarAgenda(); return a; };

(async () => {
  let checks = 0;
  const initial = await start("admin");
  assert.equal(count(initial,"listar_bloqueios_painel"),1);
  assert.equal(initial.state.plans,1);
  assert.equal(initial.fields["salvar-bloqueio"].disabled,false);
  assert.match(initial.fields["lista-bloqueios"].textContent,/Nenhum bloqueio/);
  checks++;

  const listed = await start();
  listed.state.rows = [{...row},{...row,id:9,dia_inteiro:true}];
  await listed.context.carregarBloqueios();
  assert.equal(listed.fields["lista-bloqueios"].children.length,2);
  assert.match(listed.fields["lista-bloqueios"].textContent,/03\/11\/2026.*14:00 às 15:00.*Lucas.*Compromisso/);
  assert.match(listed.fields["lista-bloqueios"].textContent,/Dia inteiro/);
  checks++;

  const safe = await start();
  safe.state.rows = [{...row,motivo:'<img src=x onerror="alert(1)">'}];
  await safe.context.carregarBloqueios();
  const card = safe.fields["lista-bloqueios"].children[0];
  assert.equal(card.children[3].textContent,'<img src=x onerror="alert(1)">');
  assert.equal(card.children[3].children.length,0);
  checks++;

  for(const mode of ["error","throw","empty"]) {
    const a = await start();
    a.state.listar = async () => {
      if(mode === "throw") throw new Error("offline");
      return mode === "error" ? {data:null,error:{message:"offline"}} : {data:null,error:null};
    };
    assert.equal(await a.context.carregarBloqueios(),false);
    assert.match(a.fields["lista-bloqueios"].textContent,/Não foi possível carregar/);
    assert.equal(a.fields["lista-bloqueios"].attributes["aria-busy"],"false");
    assert.equal(a.fields["atualizar-bloqueios"].disabled,false);
    checks++;
  }

  const race = await start();
  const resolvers = [];
  race.state.listar = () => new Promise(resolve => resolvers.push(resolve));
  const older = race.context.carregarBloqueios();
  const newer = race.context.carregarBloqueios();
  resolvers[1]({data:[{...row,motivo:"Resposta recente"}],error:null});
  await newer;
  resolvers[0]({data:[{...row,motivo:"Resposta antiga"}],error:null});
  await older;
  assert.match(race.fields["lista-bloqueios"].textContent,/Resposta recente/);
  assert.doesNotMatch(race.fields["lista-bloqueios"].textContent,/Resposta antiga/);
  checks++;

  const partial = await start();
  partial.fill();
  await partial.submit();
  const payload = partial.state.calls.find(c => c.name === "criar_bloqueio").payload;
  assert.equal(payload.p_barbeiro_id,1);
  assert.equal(payload.p_horario_inicio,"14:00");
  assert.equal(payload.p_horario_fim,"15:00");
  assert.equal(payload.p_motivo,"Compromisso");
  assert.equal(count(partial,"listar_bloqueios_painel"),2);
  assert.match(partial.fields["mensagem-bloqueio"].textContent,/adicionado com sucesso/);
  assert.equal(partial.fields["salvar-bloqueio"].disabled,false);
  checks++;

  const full = await start();
  full.fill();
  full.fields["bloqueio-dia-inteiro"].checked = true;
  full.context.atualizarCamposHorarioBloqueio();
  assert(full.horarios.every(h => h.hidden));
  assert.equal(full.fields["bloqueio-inicio"].disabled,true);
  await full.submit();
  const fullPayload = full.state.calls.find(c => c.name === "criar_bloqueio").payload;
  assert.equal(fullPayload.p_dia_inteiro,true);
  assert.equal(fullPayload.p_horario_inicio,null);
  assert.equal(fullPayload.p_horario_fim,null);
  assert(full.horarios.every(h => !h.hidden));
  assert.equal(full.fields["bloqueio-inicio"].required,true);
  checks++;

  const invalid = await start();
  invalid.fill();
  invalid.fields["bloqueio-fim"].value = "13:00";
  await invalid.submit();
  assert.equal(count(invalid,"criar_bloqueio"),0);
  assert.match(invalid.fields["mensagem-bloqueio"].textContent,/maior que o inicial/);
  checks++;

  const invalidForm = await start();
  invalidForm.fill();
  invalidForm.state.valid = false;
  await invalidForm.submit();
  assert.equal(count(invalidForm,"criar_bloqueio"),0);
  checks++;

  const unauth = app();
  unauth.fill();
  await unauth.submit();
  assert.equal(count(unauth,"criar_bloqueio"),0);
  checks++;

  const invalidBarber = await start();
  invalidBarber.fill();
  invalidBarber.fields["bloqueio-barbeiro"].value = "";
  await invalidBarber.submit();
  assert.equal(count(invalidBarber,"criar_bloqueio"),0);
  checks++;

  const waiting = await start();
  waiting.fill();
  let release;
  waiting.state.criar = () => new Promise(resolve => { release=resolve; });
  const saving = waiting.submit();
  assert.equal(waiting.fields["salvar-bloqueio"].disabled,true);
  assert.equal(waiting.fields["bloqueio-data"].disabled,true);
  await waiting.submit();
  assert.equal(count(waiting,"criar_bloqueio"),1);
  release({data:50,error:null});
  await saving;
  assert.equal(waiting.fields["salvar-bloqueio"].disabled,false);
  assert.equal(waiting.fields["bloqueio-data"].disabled,false);
  checks++;

  for(const mode of ["business","throw"]) {
    const a = await start();
    a.fill();
    a.state.criar = async () => {
      if(mode === "throw") throw new Error("offline");
      return {data:null,error:{code:"P0001",message:"Já existe um bloqueio nesse período."}};
    };
    await a.submit();
    assert.equal(a.fields["salvar-bloqueio"].disabled,false);
    assert.equal(a.fields["bloqueio-data"].disabled,false);
    assert.equal(a.fields["bloqueio-motivo"].value,"  Compromisso  ");
    assert.match(a.fields["mensagem-bloqueio"].textContent,
      mode === "business" ? /Já existe/ : /Atualize a lista/);
    checks++;
  }

  const saved = await start();
  saved.fill();
  saved.state.listar = async () => { throw new Error("offline"); };
  await saved.submit();
  assert.match(saved.fields["mensagem-bloqueio"].textContent,/Bloqueio adicionado.*Atualizar/);
  assert.equal(count(saved,"criar_bloqueio"),1);
  checks++;

  const removed = await start();
  removed.state.rows = [{...row}];
  await removed.context.carregarBloqueios();
  const removeButton = removed.fields["lista-bloqueios"].children[0].children[4];
  await removeButton.listeners.click[0]();
  assert.equal(count(removed,"desativar_bloqueio"),1);
  assert.equal(removed.state.calls.find(c=>c.name==="desativar_bloqueio").payload.p_bloqueio_id,8);
  assert.match(removed.fields["lista-bloqueios"].textContent,/Nenhum bloqueio/);
  checks++;

  const refused = await start();
  refused.state.rows = [{...row}];
  refused.state.remover = async () => ({data:null,error:{code:"P0001",message:"Bloqueio não encontrado ou pertence a outro barbeiro."}});
  await refused.context.carregarBloqueios();
  const refusedButton = refused.fields["lista-bloqueios"].children[0].children[4];
  await refusedButton.listeners.click[0]();
  assert.equal(refusedButton.disabled,false);
  assert.match(refused.fields["mensagem-bloqueio"].textContent,/outro barbeiro/);
  assert.equal(refused.fields["lista-bloqueios"].children.length,1);
  checks++;

  const twice = await start();
  twice.state.rows = [{...row}];
  let removeRelease;
  twice.state.remover = () => new Promise(resolve => {removeRelease=resolve;});
  await twice.context.carregarBloqueios();
  const twiceButton = twice.fields["lista-bloqueios"].children[0].children[4];
  const removing = twiceButton.listeners.click[0]();
  await twiceButton.listeners.click[0]();
  assert.equal(count(twice,"desativar_bloqueio"),1);
  removeRelease({data:8,error:null});
  await removing;
  checks++;

  const barber = await start("barbeiro");
  assert.equal(barber.fields["campo-bloqueio-barbeiro"].hidden,true);
  assert.equal(barber.fields["filtro-barbeiro"].wrapper.hidden,true);
  barber.fill();
  barber.fields["bloqueio-barbeiro"].value = "2";
  await barber.submit();
  assert.equal(barber.state.calls.find(c=>c.name==="criar_bloqueio").payload.p_barbeiro_id,1);
  assert.equal(barber.fields["bloqueio-barbeiro"].value,"1");
  checks++;

  const independent = app();
  independent.state.failAgenda = true;
  await independent.context.iniciarAgenda();
  assert.equal(count(independent,"listar_bloqueios_painel"),1);
  assert.equal(independent.state.plans,1);
  assert.equal(independent.fields["salvar-bloqueio"].disabled,false);
  checks++;

  console.log("PASS: " + checks + " cenários do painel de bloqueios com DOM e Supabase simulados.");
})().catch(error => {console.error(error);process.exitCode=1;});
