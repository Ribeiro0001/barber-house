const selectServico = document.getElementById("servico");

const selectBarbeiro = document.getElementById("barbeiro");

const selectHorario = document.getElementById("horario");

const formulario = document.getElementById("form-agendamento");

const mensagemFormulario = document.getElementById("mensagem-formulario");

const campoData = document.getElementById("data");

const botoesPlano = document.querySelectorAll(".botao-plano");

const selectCategoria = document.getElementById("categoria");

const cardAgendamento = document.querySelector(".card-agendamento");

const hoje = new Date();

const ano = hoje.getFullYear();
const mes = String(hoje.getMonth() + 1).padStart(2, "0");
const dia = String(hoje.getDate()).padStart(2, "0");

const dataMinima = `${ano}-${mes}-${dia}`;

campoData.min = dataMinima;

for (let i = 0; i < botoesPlano.length; i++) {
  botoesPlano[i].addEventListener("click", function () {
    selectCategoria.value = "plano";

    cardAgendamento.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

for (let i = 0; i < servicos.length; i++) {
  const opcao = document.createElement("option");

  opcao.value = servicos[i];
  opcao.textContent = servicos[i];
  selectServico.appendChild(opcao);
}

for (let i = 0; i < barbeiros.length; i++) {
  const opcao = document.createElement("option");

  opcao.value = barbeiros[i];
  opcao.textContent = barbeiros[i];
  selectBarbeiro.appendChild(opcao);
}

function atualizarHorarios() {
  selectHorario.innerHTML = `<option value="">Selecione o horário</option>`;
  const dataSelecionada = campoData.value;
  const barbeiroSelecionado = selectBarbeiro.value;

  if (dataSelecionada === "" || barbeiroSelecionado === "") {
    return;
  }

  const agendamentosSalvos =
    JSON.parse(localStorage.getItem("agendamentos")) || [];

  const agora = new Date();

  const horaAtual = String(agora.getHours()).padStart(2, "0");

  const minutoAtual = String(agora.getMinutes()).padStart(2, "0");

  const horarioAtual = `${horaAtual}:${minutoAtual}`;

  const dataEhHoje = dataSelecionada === dataMinima;

  for (let i = 0; i < horarios.length; i++) {
    const horarioPassou = dataEhHoje && horarios[i] <= horarioAtual;

    const horarioOcupado = agendamentosSalvos.some(function (item) {
      return (
        item.data === dataSelecionada &&
        item.barbeiro === barbeiroSelecionado &&
        item.horario === horarios[i]
      );
    });

    if (selectHorario.options.length === 1) {
      selectHorario.options[0].textContent = "Nenhum horário disponível";

      selectHorario.options[0].disabled = true;
    }

    if (horarioPassou || horarioOcupado) {
      continue;
    }

    const opcao = document.createElement("option");

    opcao.value = horarios[i];
    opcao.textContent = horarios[i];
    selectHorario.appendChild(opcao);
  }
}

campoData.addEventListener("change", atualizarHorarios);
selectBarbeiro.addEventListener("change", atualizarHorarios);

formulario.addEventListener("submit", function (evento) {
  evento.preventDefault();
  const nome = document.getElementById("nome").value;
  const telefone = document.getElementById("telefone").value;
  const servico = document.getElementById("servico").value;
  const barbeiro = document.getElementById("barbeiro").value;
  const horario = document.getElementById("horario").value;
  const categoria = document.getElementById("categoria").value;
  const data = document.getElementById("data").value;

  const agendamento = {
    nome: nome,
    telefone: telefone,
    servico: servico,
    barbeiro: barbeiro,
    horario: horario,
    categoria: categoria,
    data: data,
  };

  const agendamentosSalvos =
    JSON.parse(localStorage.getItem("agendamentos")) || [];

  const horarioOcupado = agendamentosSalvos.some(function (item) {
    return (
      item.barbeiro === barbeiro &&
      item.data === data &&
      item.horario === horario
    );
  });

  if (horarioOcupado) {
    mensagemFormulario.textContent = "Este horário já está ocupado.";
    return;
  }

  agendamentosSalvos.push(agendamento);

  localStorage.setItem("agendamentos", JSON.stringify(agendamentosSalvos));

  mensagemFormulario.textContent = "Agendamento confirmado com sucesso!";
  formulario.reset();
  atualizarHorarios();
});
