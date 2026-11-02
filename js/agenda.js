let perfilUsuario = null;

async function verificarAutenticacao() {
  const {
    data: { session },
    error: erroSessao,
  } = await clienteSupabase.auth.getSession();

  if (erroSessao || !session) {
    window.location.replace("login.html");
    return false;
  }

  const { data: perfil, error: erroPerfil } = await clienteSupabase
    .from("perfis")
    .select("nome, tipo, barbeiro_id, ativo")
    .eq("usuario_id", session.user.id)
    .single();

  if (erroPerfil || !perfil || !perfil.ativo) {
    console.error("Perfil inválido:", erroPerfil);

    await clienteSupabase.auth.signOut();
    window.location.replace("login.html");

    return false;
  }

  perfilUsuario = perfil;

  console.log("Perfil autenticado:", perfilUsuario);

  return true;
}

const filtroData = document.getElementById("filtro-data");

const filtroBarbeiro = document.getElementById("filtro-barbeiro");

const resumoAgenda = document.getElementById("resumo-agenda");

const listaAgendamentos = document.getElementById("lista-agendamentos");

const filtroStatus = document.getElementById("filtro-status");

const listaRanking = document.getElementById("lista-ranking");

const formularioBloqueio = document.getElementById("form-bloqueio");

const selectBloqueioBarbeiro = document.getElementById("bloqueio-barbeiro");

const campoBloqueioBarbeiro = document.getElementById(
  "campo-bloqueio-barbeiro",
);

const campoBloqueioData = document.getElementById("bloqueio-data");

const campoBloqueioDiaInteiro = document.getElementById("bloqueio-dia-inteiro");

const campoBloqueioInicio = document.getElementById("bloqueio-inicio");

const campoBloqueioFim = document.getElementById("bloqueio-fim");

const campoBloqueioMotivo = document.getElementById("bloqueio-motivo");

const mensagemBloqueio = document.getElementById("mensagem-bloqueio");

const listaBloqueios = document.getElementById("lista-bloqueios");

let agendamentos = [];

const botaoSair = document.getElementById("botao-sair");

const modalConclusao = document.getElementById("modal-conclusao");
const formularioConclusao = document.getElementById("form-conclusao");
const servicoBaseConclusao = document.getElementById("servico-base-conclusao");
const pontosConclusao = document.getElementById("pontos-conclusao");
const mensagemConclusao = document.getElementById("mensagem-conclusao");
const botaoVoltarConclusao = document.getElementById("cancelar-conclusao");
const botaoConfirmarConclusao = document.getElementById("confirmar-conclusao");

const camposAdicionais = formularioConclusao.querySelectorAll(
  'input[name="adicionais"]',
);

const pontosAdicionais = {
  pezinho: 10,
  barba: 20,
  sobrancelha: 10,
};

let agendamentoEmConclusao = null;

let conclusaoEmAndamento = false;

function atualizarPontosConclusao() {
  if (!agendamentoEmConclusao) {
    return;
  }

  if (agendamentoEmConclusao.categoria !== "plano") {
    pontosConclusao.textContent = "Atendimento avulso: 0 pontos no ranking.";
    return;
  }

  let totalPontos = Number(agendamentoEmConclusao.pontos);

  for (const campo of camposAdicionais) {
    if (campo.checked && !campo.disabled) {
      totalPontos += pontosAdicionais[campo.value];
    }
  }

  pontosConclusao.textContent = "Pontos previstos no ranking: " + totalPontos;
}

function abrirConclusao(agendamento) {
  formularioConclusao.reset();
  agendamentoEmConclusao = agendamento;
  mensagemConclusao.textContent = "";
  botaoConfirmarConclusao.disabled = false;

  servicoBaseConclusao.textContent =
    agendamento.nome + " — " + agendamento.servico;

  const servicosIncluidos = agendamento.servico
    .toLowerCase()
    .split("+")
    .map(function (parte) {
      return parte.trim();
    });

  for (const campo of camposAdicionais) {
    campo.disabled = servicosIncluidos.includes(campo.value);
  }

  atualizarPontosConclusao();
  modalConclusao.showModal();
}

formularioConclusao.addEventListener("change", atualizarPontosConclusao);

formularioConclusao.addEventListener("submit", async function (evento) {
  evento.preventDefault();

  if (!agendamentoEmConclusao || conclusaoEmAndamento) {
    return;
  }

  const agendamentoId = agendamentoEmConclusao.id;
  const adicionais = [];

  for (const campo of camposAdicionais) {
    if (campo.checked && !campo.disabled) {
      adicionais.push(campo.value);
    }
  }

  conclusaoEmAndamento = true;
  botaoConfirmarConclusao.disabled = true;
  botaoVoltarConclusao.disabled = true;
  botaoConfirmarConclusao.textContent = "Concluindo...";
  mensagemConclusao.textContent = "";

  let conclusaoSalva = false;

  try {
    const { data: pontosConfirmados, error } = await clienteSupabase.rpc(
      "concluir_agendamento_com_adicionais",
      {
        p_agendamento_id: agendamentoId,
        p_adicionais: adicionais,
      },
    );

    if (error) {
      console.error("Erro ao concluir atendimento:", error);
      mensagemConclusao.textContent = error.message;
      return;
    }

    conclusaoSalva = true;
    modalConclusao.close();

    await carregarAgendamentos();
    await carregarRanking();

    resumoAgenda.textContent =
      "Atendimento concluído! Pontos registrados: " + pontosConfirmados;
  } catch (erro) {
    console.error("Erro na conclusão:", erro);

    if (conclusaoSalva) {
      resumoAgenda.textContent =
        "Atendimento concluído. Atualize a página para conferir o painel.";
    } else {
      mensagemConclusao.textContent =
        "Não foi possível confirmar o resultado. Confira a agenda antes de tentar novamente.";
    }
  } finally {
    conclusaoEmAndamento = false;
    botaoConfirmarConclusao.disabled = false;
    botaoVoltarConclusao.disabled = false;
    botaoConfirmarConclusao.textContent = "Confirmar conclusão";
  }
});

modalConclusao.addEventListener("cancel", function (evento) {
  if (conclusaoEmAndamento) {
    evento.preventDefault();
  }
});

botaoVoltarConclusao.addEventListener("click", function () {
  modalConclusao.close();
});

modalConclusao.addEventListener("close", function () {
  agendamentoEmConclusao = null;
});

async function carregarfiltroBarbeiros() {
  const { data: barbeirosDoBanco, error } = await clienteSupabase
    .from("barbeiros")
    .select("id, nome")
    .eq("ativo", true)
    .order("nome");

  if (error) {
    resumoAgenda.textContent = "Não foi possível carregar os barbeiros";
    return;
  }
  for (let i = 0; i < barbeirosDoBanco.length; i++) {
    const barbeiro = barbeirosDoBanco[i];

    const opcao = document.createElement("option");

    opcao.value = String(barbeiro.id);
    opcao.textContent = barbeiro.nome;
    opcao.dataset.id = barbeiro.id;

    filtroBarbeiro.appendChild(opcao);

    const opcaoBloqueio = document.createElement("option");

    opcaoBloqueio.value = barbeiro.id;
    opcaoBloqueio.textContent = barbeiro.nome;

    selectBloqueioBarbeiro.appendChild(opcaoBloqueio);
  }
}

async function carregarAgendamentos() {
  const { data: agendamentosDoBanco, error } = await clienteSupabase.rpc(
    "listar_agendamentos_painel",
  );

  if (error) {
    console.error("Erro ao carregar agendamentos:", error);

    resumoAgenda.textContent = "Não foi possível carregar os agendamentos.";

    return;
  }

  agendamentos = agendamentosDoBanco.map(function (item) {
    return {
      id: item.id,
      nome: item.nome_cliente,
      telefone: item.telefone,

      barbeiroId: item.barbeiro_id,
      barbeiro: item.barbeiro_nome,

      servicoId: item.servico_id,
      servico: item.servico_nome,

      data: item.data,
      horario: item.horario_inicio.slice(0, 5),
      horarioFim: item.horario_fim.slice(0, 5),

      categoria: item.categoria,
      status: item.status,

      preco: item.preco_cobrado,
      pontos: item.pontos_gerados,
    };
  });

  filtrarAgendamentos();
}

async function carregarRanking() {
  const { data: ranking, error } = await clienteSupabase.rpc(
    "listar_ranking_pontos",
  );

  if (error) {
    console.error("Erro ao carregar o ranking:", error);
    listaRanking.innerHTML = `<p class="agenda-vazia">Não foi possível carregar o ranking.</p>`;
    return;
  }

  listaRanking.innerHTML = "";

  for (let i = 0; i < ranking.length; i++) {
    const item = ranking[i];

    const card = document.createElement("article");
    card.classList.add("card-ranking");

    const temPontos = Number(item.total_pontos) > 0;

    if (temPontos && Number(item.posicao) === 1) {
      card.classList.add("ranking-lider");
    }

    const posicao = document.createElement("span");
    posicao.classList.add("ranking-posicao");

    const medalhas = {
      1: "🥇",
      2: "🥈",
      3: "🥉",
    };

    posicao.textContent = temPontos
      ? medalhas[item.posicao] || `${item.posicao}º`
      : "—";

    const informacoes = document.createElement("div");
    informacoes.classList.add("ranking-informacoes");

    const nome = document.createElement("h3");
    nome.textContent = item.barbeiro_nome;

    const detalhes = document.createElement("p");

    detalhes.textContent =
      `${item.total_pontos} pontos • ` +
      `${item.total_atendimentos} atendimento(s)`;

    informacoes.appendChild(nome);
    informacoes.appendChild(detalhes);

    card.appendChild(posicao);
    card.appendChild(informacoes);

    listaRanking.appendChild(card);
  }
}

async function atualizarStatusAgendamento(agendamentoId, novoStatus) {
  const { error } = await clienteSupabase.rpc("atualizar_status_agendamento", {
    p_agendamento_id: agendamentoId,
    p_status: novoStatus,
  });

  if (error) {
    console.error("Erro ao atualizar status:", error);

    resumoAgenda.textContent = error.message;

    return;
  }

  await carregarAgendamentos();
  await carregarRanking();
}

function exibirAgendamentos(lista) {
  listaAgendamentos.innerHTML = "";

  resumoAgenda.textContent = `${lista.length} agendamento(s) encontrado(s)`;

  if (lista.length === 0) {
    const mensagemVazia = document.createElement("p");

    mensagemVazia.classList.add("agenda-vazia");
    mensagemVazia.textContent = "Nenhum agendamento encontrado.";

    listaAgendamentos.appendChild(mensagemVazia);

    return;
  }

  for (let i = 0; i < lista.length; i++) {
    const agendamento = lista[i];

    const card = document.createElement("article");
    card.classList.add("card-agenda");

    const titulo = document.createElement("h2");
    titulo.textContent = `${agendamento.horario} - ${agendamento.nome}`;

    const detalhes = document.createElement("p");
    detalhes.classList.add("detalhes-agenda");

    detalhes.textContent =
      `${agendamento.barbeiro} • ` +
      `${agendamento.servico} • ` +
      `${agendamento.categoria}`;

    const contato = document.createElement("p");

    contato.classList.add("contato-agenda");

    contato.textContent = `WhatsApp: ${agendamento.telefone}`;

    const statusAgendamento = document.createElement("p");

    statusAgendamento.classList.add("status-agendamento");

    const textosStatus = {
      agendado: "Agendado",
      concluido: "Concluído",
      cancelado: "Cancelado",
    };

    statusAgendamento.textContent = `Status: ${textosStatus[agendamento.status]}`;

    const botaoConcluir = document.createElement("button");

    botaoConcluir.type = "button";

    botaoConcluir.textContent = "Concluir";

    botaoConcluir.classList.add("botao-concluir");

    botaoConcluir.addEventListener("click", function () {
      abrirConclusao(agendamento);
    });

    const botaoCancelar = document.createElement("button");

    botaoCancelar.type = "button";

    botaoCancelar.textContent = "Cancelar";

    botaoCancelar.classList.add("botao-cancelar");

    botaoCancelar.addEventListener("click", async function () {
      botaoCancelar.disabled = true;

      await atualizarStatusAgendamento(agendamento.id, "cancelado");
    });

    card.appendChild(titulo);
    card.appendChild(detalhes);
    card.appendChild(contato);
    card.appendChild(statusAgendamento);

    if (agendamento.status === "agendado") {
      card.appendChild(botaoConcluir);
      card.appendChild(botaoCancelar);
    }

    listaAgendamentos.appendChild(card);
  }
}

function filtrarAgendamentos() {
  const dataSelecionada = filtroData.value;
  const barbeiroSelecionado = filtroBarbeiro.value;
  const statusSelecionado = filtroStatus.value;

  const agendamentosFiltrados = agendamentos.filter(function (item) {
    const correspondeData =
      dataSelecionada === "" || item.data === dataSelecionada;

    const correspondeBarbeiro =
      barbeiroSelecionado === "" ||
      String(item.barbeiroId) === barbeiroSelecionado;

    const statusDoItem = item.status ? item.status.toLowerCase() : "";

    const correspondeStatus =
      statusSelecionado === "" || statusDoItem === statusSelecionado;

    return correspondeData && correspondeBarbeiro && correspondeStatus;
  });

  agendamentosFiltrados.sort(function (primeiro, segundo) {
    return primeiro.horario.localeCompare(segundo.horario);
  });

  exibirAgendamentos(agendamentosFiltrados);
}

botaoSair.addEventListener("click", async function () {
  await clienteSupabase.auth.signOut();

  window.location.replace("login.html");
});

filtroData.addEventListener("change", filtrarAgendamentos);
filtroBarbeiro.addEventListener("change", filtrarAgendamentos);
filtroStatus.addEventListener("change", filtrarAgendamentos);

const hoje = new Date();

const anoAtual = hoje.getFullYear();
const mesAtual = String(hoje.getMonth() + 1).padStart(2, "0");
const diaAtual = String(hoje.getDate()).padStart(2, "0");

const dataHoje = `${anoAtual}-${mesAtual}-${diaAtual}`;

filtroData.value = dataHoje;
campoBloqueioData.min = dataHoje;
campoBloqueioData.value = dataHoje;

async function iniciarAgenda() {
  const acessoLiberado = await verificarAutenticacao();

  if (!acessoLiberado) {
    return;
  }

  if (perfilUsuario.tipo === "admin") {
    await carregarfiltroBarbeiros();
  } else {
    configurarInterfaceBarbeiro();
  }

  await carregarAgendamentos();
  await carregarRanking();
  await carregarPlanosPainel();
}

function configurarInterfaceBarbeiro() {
  filtroBarbeiro.innerHTML = "";

  const opcao = document.createElement("option");

  opcao.value = String(perfilUsuario.barbeiro_id);
  opcao.textContent = perfilUsuario.nome;

  filtroBarbeiro.appendChild(opcao);
  filtroBarbeiro.value = String(perfilUsuario.barbeiro_id);

  const campoFiltroBarbeiro = filtroBarbeiro.closest(".campo");

  campoFiltroBarbeiro.hidden = true;

  selectBloqueioBarbeiro.innerHTML = "";

  const opcaoBloqueio = document.createElement("option");

  opcaoBloqueio.value = perfilUsuario.barbeiro_id;
  opcaoBloqueio.textContent = perfilUsuario.nome;

  selectBloqueioBarbeiro.appendChild(opcaoBloqueio);
  selectBloqueioBarbeiro.value = perfilUsuario.barbeiro_id;

  campoBloqueioBarbeiro.hidden = true;
}

function atualizarCamposHorarioBloqueio() {
  const bloquearDiaInteiro = campoBloqueioDiaInteiro.checked;

  campoBloqueioInicio.disabled = bloquearDiaInteiro;
  campoBloqueioFim.disabled = bloquearDiaInteiro;

  campoBloqueioInicio.required = !bloquearDiaInteiro;
  campoBloqueioFim.required = !bloquearDiaInteiro;

  if (bloquearDiaInteiro) {
    campoBloqueioInicio.value = "";
    campoBloqueioFim.value = "";
  }
}

campoBloqueioDiaInteiro.addEventListener(
  "change",
  atualizarCamposHorarioBloqueio,
);

formularioBloqueio.addEventListener("submit", async function (evento) {
  evento.preventDefault();

  const barbeiroId = Number(selectBloqueioBarbeiro.value);
  const dataBloqueio = campoBloqueioData.value;
  const diaInteiro = campoBloqueioDiaInteiro.checked;

  const horarioInicio = diaInteiro ? null : campoBloqueioInicio.value;

  const horarioFim = diaInteiro ? null : campoBloqueioFim.value;

  const motivo = campoBloqueioMotivo.value.trim();

  const botaoEnviar = formularioBloqueio.querySelector('button[type="submit"]');

  mensagemBloqueio.textContent = "Salvando bloqueio...";
  botaoEnviar.disabled = true;

  const { data: bloqueioId, error } = await clienteSupabase.rpc(
    "criar_bloqueio",
    {
      p_barbeiro_id: barbeiroId,
      p_data: dataBloqueio,
      p_dia_inteiro: diaInteiro,
      p_horario_inicio: horarioInicio,
      p_horario_fim: horarioFim,
      p_motivo: motivo,
    },
  );

  botaoEnviar.disabled = false;

  if (error) {
    console.error("Erro ao criar bloqueio:", error);
    mensagemBloqueio.textContent = error.message;
    return;
  }

  console.log("Bloqueio criado:", bloqueioId);

  mensagemBloqueio.textContent = "Bloqueio adicionado com sucesso!";

  formularioBloqueio.reset();
  campoBloqueioData.value = dataHoje;

  if (perfilUsuario.tipo === "barbeiro") {
    selectBloqueioBarbeiro.value = perfilUsuario.barbeiro_id;
  }

  atualizarCamposHorarioBloqueio();
});

atualizarCamposHorarioBloqueio();

iniciarAgenda();
