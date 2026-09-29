
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
 async function carregarServicos(){
  const {data: servicosDoBanco, error } = await clienteSupabase
  .from("servicos")
  .select("id, nome, duracao_minutos, preco, pontos")
  .eq("ativo", true)
  .order("nome")

  if(error) {
    mensagemFormulario.textContent = "Não foi possivel carregar os serviços";
    return; 
  }

  for(let i = 0; i < servicosDoBanco.length; i++) {
    const servico = servicosDoBanco[i];

    const opcao = document.createElement("option");

    opcao.value = servico.nome;
    opcao.textContent = servico.nome;

    opcao.dataset.id = servico.id;
    opcao.dataset.duracao = servico.duracao_minutos;
    opcao.dataset.preco = servico.preco;
    opcao.dataset.pontos = servico.pontos;

    selectServico.appendChild(opcao)
  }
}
carregarServicos();


 async function carregarBarbeiros(){
  const {data: barbeirosDoBanco, error } = await clienteSupabase
  .from("barbeiros")
  .select("id, nome")
  .eq("ativo", true)
  .order("nome");
 
  if (error){
    mensagemFormulario.textContent = "Não foi possivel carregar os barbeiros";
    return;
  }

  for (let i = 0; i < barbeirosDoBanco.length; i++) {
    const barbeiro = barbeirosDoBanco[i];

    const opcao = document.createElement("option");

    opcao.value = barbeiro.nome;

    opcao.textContent = barbeiro.nome;

    opcao.dataset.id = barbeiro.id;

    selectBarbeiro.appendChild(opcao);

  }
 }
 carregarBarbeiros();

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
        item.status !== "cancelado" &&
        item.data === dataSelecionada &&
        item.barbeiro === barbeiroSelecionado &&
        item.horario === horarios[i]
      );
    });
    if (horarioPassou || horarioOcupado) {
      continue;
    }

    const opcao = document.createElement("option");

    opcao.value = horarios[i];
    opcao.textContent = horarios[i];
    selectHorario.appendChild(opcao);
  }

  if (selectHorario.options.length === 1) {
    selectHorario.options[0].textContent = "Nenhum horário disponível";

    selectHorario.options[0].disabled = true;
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
    id: Date.now(),
    nome: nome,
    telefone: telefone,
    servico: servico,
    barbeiro: barbeiro,
    horario: horario,
    categoria: categoria,
    data: data,
    status: "agendado",
  };

  const agendamentosSalvos =
    JSON.parse(localStorage.getItem("agendamentos")) || [];

  const horarioOcupado = agendamentosSalvos.some(function (item) {
    return (
      item.status !== "cancelado" &&
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
