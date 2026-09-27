const filtroData = document.getElementById("filtro-data");

const filtroBarbeiro = document.getElementById("filtro-barbeiro");

const resumoAgenda = document.getElementById("resumo-agenda");

const listaAgendamentos = document.getElementById("lista-agendamentos");

const filtroStatus = document.getElementById("filtro-status");

const agendamentos = JSON.parse(localStorage.getItem("agendamentos")) || [];

const botaoSair = document.getElementById("botao-sair");

for (let i = 0; i < barbeiros.length; i++) {
  const opcao = document.createElement("option");

  opcao.value = barbeiros[i];
  opcao.textContent = barbeiros[i];
  filtroBarbeiro.appendChild(opcao);
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

    const partesData = agendamento.data.split("-");

    const dataFormatada = `${partesData[2]}/${partesData[1]}/${partesData[0]}`;

    const card = document.createElement("article");
    card.classList.add("card-agenda");

    const titulo = document.createElement("h2");
    titulo.textContent = `${agendamento.horario} - ${agendamento.nome}`;

    const detalhes = document.createElement("p");

    detalhes.classList.add("detalhes-agenda");

    detalhes.textContent =
      `${dataFormatada} | ${agendamento.barbeiro} | ` +
      `${agendamento.servico} | ${agendamento.categoria}`;

    const contato = document.createElement("p");

    contato.classList.add("contato-agenda");

    contato.textContent = `WhatsApp: ${agendamento.telefone}`;

    const statusAgendamento = document.createElement("p");

    statusAgendamento.classList.add("status-agendamento");

    statusAgendamento.textContent = `Status: ${agendamento.status}`;

    const botaoConcluir = document.createElement("button");

    botaoConcluir.type = "button";

    botaoConcluir.textContent = "Concluir";

    botaoConcluir.classList.add("botao-concluir");

    botaoConcluir.addEventListener("click", function () {
      const agendamentoEncontrado = agendamentos.find(function (item) {
        return item.id === agendamento.id;
      });
      agendamentoEncontrado.status = "concluído";

      localStorage.setItem("agendamentos", JSON.stringify(agendamentos));
      filtrarAgendamentos();
    });

    const botaoCancelar = document.createElement("button");

    botaoCancelar.type = "button";

    botaoCancelar.textContent = "Cancelar";

    botaoCancelar.classList.add("botao-cancelar");

    botaoCancelar.addEventListener("click", function () {
      const agendamentoEncontrado = agendamentos.find(function (item) {
        return item.id === agendamento.id;
      });
      agendamentoEncontrado.status = "cancelado";

      localStorage.setItem("agendamentos", JSON.stringify(agendamentos));
      filtrarAgendamentos();
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

exibirAgendamentos(agendamentos);

function filtrarAgendamentos() {
  const dataSelecionada = filtroData.value;
  const barbeiroSelecionado = filtroBarbeiro.value;
  const statusSelecionado = filtroStatus.value;

  const agendamentosFiltrados = agendamentos.filter(function (item) {
    const correspondeData =
      dataSelecionada === "" || item.data === dataSelecionada;

    const correspondeBarbeiro =
      barbeiroSelecionado === "" || item.barbeiro === barbeiroSelecionado;

    const statusDoItem = item.status ? item.status.toLowerCase() : "";

    const correspondeStatus =
      statusSelecionado === "" || statusDoItem === statusSelecionado;

    return correspondeData && correspondeBarbeiro && correspondeStatus;
  });

  exibirAgendamentos(agendamentosFiltrados);
}

botaoSair.addEventListener("click", function () {
  sessionStorage.removeItem("usuarioLogado");

  window.location.replace("login.html");
});

filtroData.addEventListener("change", filtrarAgendamentos);
filtroBarbeiro.addEventListener("change", filtrarAgendamentos);
filtroStatus.addEventListener("change", filtrarAgendamentos);
