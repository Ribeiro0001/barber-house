const selectServico = document.getElementById("servico");

const selectBarbeiro = document.getElementById("barbeiro");

const selectHorario = document.getElementById("horario");

const formulario = document.getElementById("form-agendamento");

const mensagemFormulario = document.getElementById("mensagem-formulario");

const linkWhatsapp = document.getElementById("link-whatsapp");

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
async function carregarServicos() {
  const { data: servicosDoBanco, error } = await clienteSupabase
    .from("servicos")
    .select("id, nome, duracao_minutos, preco, pontos")
    .eq("ativo", true)
    .eq("agendavel_online", true)
    .order("nome");

  if (error) {
    console.error("Erro ao carregar serviços:", error);

    mensagemFormulario.textContent = "Não foi possível carregar os serviços.";

    return;
  }

  for (let i = 0; i < servicosDoBanco.length; i++) {
    const servico = servicosDoBanco[i];

    const opcao = document.createElement("option");

    const precoFormatado = Number(servico.preco).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

    opcao.value = servico.nome;
    const precoInicial =
      servico.nome === "Reflexo (a partir de)" ||
      servico.nome === "Nevou (a partir de)";

    if (precoInicial) {
      const nomeServico = servico.nome.replace(" (a partir de)", "");

      opcao.textContent = `${nomeServico} — a partir de ${precoFormatado}`;
    } else {
      opcao.textContent = `${servico.nome} — ${precoFormatado}`;
    }

    opcao.dataset.id = servico.id;
    opcao.dataset.duracao = servico.duracao_minutos;
    opcao.dataset.preco = servico.preco;
    opcao.dataset.pontos = servico.pontos;

    selectServico.appendChild(opcao);
  }
}

carregarServicos();

async function carregarBarbeiros() {
  const { data: barbeirosDoBanco, error } = await clienteSupabase
    .from("barbeiros")
    .select("id, nome, whatsapp")
    .eq("ativo", true)
    .order("nome");

  if (error) {
    mensagemFormulario.textContent = "Não foi possivel carregar os barbeiros";
    return;
  }

  for (let i = 0; i < barbeirosDoBanco.length; i++) {
    const barbeiro = barbeirosDoBanco[i];

    const opcao = document.createElement("option");

    opcao.value = barbeiro.nome;

    opcao.textContent = barbeiro.nome;

    opcao.dataset.id = barbeiro.id;

    opcao.dataset.whatsapp = barbeiro.whatsapp;

    selectBarbeiro.appendChild(opcao);
  }
}
carregarBarbeiros();

campoData.addEventListener("change", atualizarHorarios);
selectBarbeiro.addEventListener("change", atualizarHorarios);
selectServico.addEventListener("change", atualizarHorarios);

function calcularHorarioFim(horarioInicio, duracaoMinutos) {
  const partesHorario = horarioInicio.split(":");

  const horas = Number(partesHorario[0]);
  const minutos = Number(partesHorario[1]);

  const totalMinutos = horas * 60 + minutos + duracaoMinutos;

  const horaFinal = Math.floor(totalMinutos / 60);
  const minutoFinal = totalMinutos % 60;

  return `${String(horaFinal).padStart(2, "0")}:${String(minutoFinal).padStart(2, "0")}`;
}

async function atualizarHorarios() {
  selectHorario.innerHTML = `<option value="">Selecione o horário</option>`;

  const dataSelecionada = campoData.value;
  const barbeiroSelecionado = selectBarbeiro.value;
  const servicoSelecionado = selectServico.value;

  if (
    dataSelecionada === "" ||
    barbeiroSelecionado === "" ||
    servicoSelecionado === ""
  ) {
    return;
  }

  const opcaoBarbeiro = selectBarbeiro.options[selectBarbeiro.selectedIndex];

  const opcaoServico = selectServico.options[selectServico.selectedIndex];

  const barbeiroId = Number(opcaoBarbeiro.dataset.id);
  const servicoId = Number(opcaoServico.dataset.id);

  const { data: horariosDisponiveis, error } = await clienteSupabase.rpc(
    "listar_horarios_disponiveis",
    {
      p_barbeiro_id: barbeiroId,
      p_servico_id: servicoId,
      p_data: dataSelecionada,
    },
  );

  if (error) {
    console.error("Erro ao carregar horários:", error);
    mensagemFormulario.textContent = "Não foi possível carregar os horários.";
    return;
  }

  for (let i = 0; i < horariosDisponiveis.length; i++) {
    const horario = horariosDisponiveis[i].horario.slice(0, 5);

    const opcao = document.createElement("option");

    opcao.value = horario;
    opcao.textContent = horario;

    selectHorario.appendChild(opcao);
  }

  if (selectHorario.options.length === 1) {
    selectHorario.options[0].textContent = "Nenhum horário disponível";

    selectHorario.options[0].disabled = true;
  }
}

formulario.addEventListener("submit", async function (evento) {
  evento.preventDefault();
  linkWhatsapp.hidden = true;
  linkWhatsapp.href = "#";
  const nome = document.getElementById("nome").value;
  const telefone = document.getElementById("telefone").value;
  const servico = document.getElementById("servico").value;
  const barbeiro = document.getElementById("barbeiro").value;
  const horario = document.getElementById("horario").value;
  const categoria = document.getElementById("categoria").value;
  const data = document.getElementById("data").value;

  const opcaoBarbeiroSelecionada =
    selectBarbeiro.options[selectBarbeiro.selectedIndex];

  const whatsappBarbeiro = opcaoBarbeiroSelecionada.dataset.whatsapp;
  console.log("WhatsApp selecionado:", whatsappBarbeiro);

  const opcaoServicoSelecionada =
    selectServico.options[selectServico.selectedIndex];

  const barbeiroId = Number(opcaoBarbeiroSelecionada.dataset.id);
  const servicoId = Number(opcaoServicoSelecionada.dataset.id);
  const duracaoMinutos = Number(opcaoServicoSelecionada.dataset.duracao);
  const preco = Number(opcaoServicoSelecionada.dataset.preco);
  const pontos = Number(opcaoServicoSelecionada.dataset.pontos);
  const horarioFim = calcularHorarioFim(horario, duracaoMinutos);

  console.log({
    barbeiroId,
    servicoId,
    duracaoMinutos,
    preco,
    pontos,
    horarioFim,
  });

  const { data: agendamentoCriado, error } = await clienteSupabase.rpc(
    "criar_agendamento",
    {
      p_nome_cliente: nome,
      p_telefone: telefone,
      p_barbeiro_id: barbeiroId,
      p_servico_id: servicoId,
      p_data: data,
      p_horario_inicio: horario,
      p_categoria: categoria,
    },
  );

  if (error) {
    console.error("Erro ao criar agendamento:", error);
    mensagemFormulario.textContent = error.message;

    return;
  }

  console.log("Agendamento salvo no Supabase:", agendamentoCriado);

  mensagemFormulario.textContent = "Agendamento confirmado com sucesso!";

  const partesData = data.split("-");
  const dataFormatada = `${partesData[2]}/${partesData[1]}/${partesData[0]}`;

  const precoFormatado = preco.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const mensagemWhatsapp =
    `Olá, ${barbeiro}! Fiz um agendamento pela Barber House.\n\n` +
    `Cliente: ${nome}\n` +
    `Serviço: ${servico}\n` +
    `Data: ${dataFormatada}\n` +
    `Horário: ${horario}\n` +
    `Valor: ${precoFormatado}`;

  linkWhatsapp.href =
    `https://wa.me/${whatsappBarbeiro}?text=` +
    encodeURIComponent(mensagemWhatsapp);

  linkWhatsapp.textContent = `Enviar confirmação para ${barbeiro}`;
  linkWhatsapp.hidden = false;

  formulario.reset();
  atualizarHorarios();
});
