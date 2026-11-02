const formularioPlano = document.getElementById("form-plano");
const campoNomePlano = document.getElementById("nome-cliente-plano");
const campoTelefonePlano = document.getElementById("telefone-cliente-plano");
const selectPlanoCliente = document.getElementById("plano-cliente");
const campoFormaPlano = document.getElementById("forma-pagamento-plano");
const pagamentoPlanoRecebido = document.getElementById("pagamento-plano-recebido");
const resumoPlano = document.getElementById("resumo-plano");
const mensagemPlano = document.getElementById("mensagem-plano");
const botaoSalvarPlano = document.getElementById("salvar-plano");

const moedaPlano = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const camposRegistroPlano = [
  campoNomePlano,
  campoTelefonePlano,
  selectPlanoCliente,
  campoFormaPlano,
  pagamentoPlanoRecebido,
];

let registroPlanoPreparado = false;
let salvandoPlano = false;
let operacaoPlanoPendente = null;
let chaveRegistroPlanoStorage = null;

formularioPlano.noValidate = true;

function novaChavePagamentoPlano() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");

  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" +
    hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}

function lerOperacaoPlano() {
  const texto = localStorage.getItem(chaveRegistroPlanoStorage);

  if (!texto) {
    return null;
  }

  const operacao = JSON.parse(texto);
  const uuidValido = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (
    operacao.versao !== 1 ||
    !uuidValido.test(operacao.chave) ||
    typeof operacao.nome !== "string" ||
    typeof operacao.telefone !== "string" ||
    typeof operacao.planoId !== "string" ||
    typeof operacao.forma !== "string" ||
    typeof operacao.rotulo !== "string" ||
    !operacao.nome.trim() ||
    !operacao.telefone.trim() ||
    !operacao.planoId ||
    !operacao.forma
  ) {
    throw new Error("Registro pendente inválido.");
  }

  return operacao;
}

function restaurarOperacaoPlano(operacao) {
  operacaoPlanoPendente = operacao;
  campoNomePlano.value = operacao.nome;
  campoTelefonePlano.value = operacao.telefone;
  campoFormaPlano.value = operacao.forma;
  selectPlanoCliente.value = operacao.planoId;
  pagamentoPlanoRecebido.checked = true;

  resumoPlano.textContent =
    "Registro aguardando confirmação: " + operacao.rotulo + ".";
}

function limparOperacaoPlano(chave) {
  const atual = lerOperacaoPlano();

  if (atual && atual.chave === chave) {
    localStorage.removeItem(chaveRegistroPlanoStorage);
  }
}

function atualizarBotaoPlano() {
  const bloquearCampos =
    !registroPlanoPreparado || salvandoPlano || Boolean(operacaoPlanoPendente);

  for (const campo of camposRegistroPlano) {
    campo.disabled = bloquearCampos;
  }

  if (!bloquearCampos && selectPlanoCliente.options.length <= 1) {
    selectPlanoCliente.disabled = true;
  }

  botaoSalvarPlano.disabled =
    !registroPlanoPreparado ||
    salvandoPlano ||
    (!operacaoPlanoPendente &&
      (!selectPlanoCliente.value ||
        !pagamentoPlanoRecebido.checked ||
        !formularioPlano.checkValidity()));

  botaoSalvarPlano.textContent = salvandoPlano
    ? "Registrando..."
    : operacaoPlanoPendente
      ? "Verificar pagamento anterior"
      : "Registrar pagamento e ativar/renovar";
}

async function prepararRegistroPlano() {
  registroPlanoPreparado = false;

  try {
    const { data, error } = await clienteSupabase.auth.getSession();

    if (error || !data.session) {
      throw new Error("Faça login novamente para registrar pagamentos.");
    }

    chaveRegistroPlanoStorage =
      "barber-house:pagamento-pendente:" + data.session.user.id;

    const anterior = lerOperacaoPlano();

    if (anterior) {
      restaurarOperacaoPlano(anterior);
      mensagemPlano.textContent =
        "Há um registro aguardando confirmação. Verifique esse pagamento antes de iniciar outro.";
    } else {
      operacaoPlanoPendente = null;
    }

    registroPlanoPreparado = true;
  } catch (erro) {
    console.error("Erro ao preparar registro de plano:", erro);
    mensagemPlano.textContent =
      "Não foi possível preparar o registro. Confira sua sessão e tente recarregar a página.";
  }

  atualizarBotaoPlano();
}

async function carregarPlanosPainel() {
  if (salvandoPlano) {
    return;
  }

  registroPlanoPreparado = false;
  atualizarBotaoPlano();
  mensagemPlano.textContent = "Carregando planos...";
  resumoPlano.textContent = "";

  try {
    const { data: planos, error } = await clienteSupabase.rpc(
      "listar_planos_painel",
    );

    if (error) {
      throw error;
    }

    if (!Array.isArray(planos)) {
      throw new Error("Resposta de planos inválida.");
    }

    selectPlanoCliente.innerHTML =
      '<option value="">Selecione o plano</option>';

    for (const plano of planos) {
      const opcao = document.createElement("option");
      opcao.value = plano.id;
      opcao.dataset.preco = plano.preco_mensal;
      opcao.textContent =
        plano.nome + " — " + moedaPlano.format(Number(plano.preco_mensal));
      selectPlanoCliente.appendChild(opcao);
    }

    mensagemPlano.textContent =
      planos.length === 0 ? "Nenhum plano ativo disponível." : "";

    await prepararRegistroPlano();
  } catch (erro) {
    console.error("Erro ao carregar planos:", erro);
    mensagemPlano.textContent =
      "Não foi possível carregar os planos. Atualize a página para tentar novamente.";
    atualizarBotaoPlano();
  }
}

function formatarDataPlano(data) {
  return data.split("-").reverse().join("/");
}

function erroPlanoPermiteCorrecao(erro) {
  return (
    erro.code === "P0001" &&
    !erro.message.startsWith("Usuário não autorizado") &&
    !erro.message.startsWith("Essa identificação de pagamento")
  );
}

selectPlanoCliente.addEventListener("change", function () {
  if (salvandoPlano || operacaoPlanoPendente) {
    return;
  }

  pagamentoPlanoRecebido.checked = false;
  const opcao = selectPlanoCliente.options[selectPlanoCliente.selectedIndex];

  resumoPlano.textContent = selectPlanoCliente.value
    ? "Valor a registrar: " + moedaPlano.format(Number(opcao.dataset.preco)) +
      ". Serão acrescentados 30 dias de validade."
    : "";
});

formularioPlano.addEventListener("input", atualizarBotaoPlano);
formularioPlano.addEventListener("change", atualizarBotaoPlano);

formularioPlano.addEventListener("submit", async function (evento) {
  evento.preventDefault();

  if (salvandoPlano || !registroPlanoPreparado) {
    return;
  }

  let pagamentoConfirmado = false;

  try {
    // Confere também registros iniciados em outra aba deste usuário.
    const armazenada = lerOperacaoPlano();

    if (
      armazenada &&
      (!operacaoPlanoPendente ||
        armazenada.chave !== operacaoPlanoPendente.chave)
    ) {
      restaurarOperacaoPlano(armazenada);
      mensagemPlano.textContent =
        "Há um registro anterior aguardando confirmação. Verifique-o antes de iniciar outro.";
      atualizarBotaoPlano();
      return;
    }

    if (!operacaoPlanoPendente) {
      if (
        !selectPlanoCliente.value ||
        !formularioPlano.reportValidity() ||
        !pagamentoPlanoRecebido.checked
      ) {
        return;
      }

      if (!campoNomePlano.value.trim()) {
        mensagemPlano.textContent = "Informe o nome do cliente.";
        return;
      }

      const opcao = selectPlanoCliente.options[selectPlanoCliente.selectedIndex];

      operacaoPlanoPendente = {
        versao: 1,
        chave: novaChavePagamentoPlano(),
        nome: campoNomePlano.value.trim(),
        telefone: campoTelefonePlano.value.trim(),
        planoId: selectPlanoCliente.value,
        forma: campoFormaPlano.value,
        rotulo: opcao.textContent,
      };

      // Guarda antes de enviar, para reutilizar a chave se a resposta não chegar.
      try {
        localStorage.setItem(
          chaveRegistroPlanoStorage,
          JSON.stringify(operacaoPlanoPendente),
        );
      } catch (erro) {
        operacaoPlanoPendente = null;
        registroPlanoPreparado = false;
        throw erro;
      }
    }

    const operacao = operacaoPlanoPendente;
    salvandoPlano = true;
    atualizarBotaoPlano();
    mensagemPlano.textContent = "Confirmando o registro do pagamento...";

    const { data: sessaoAtual, error: erroSessao } =
      await clienteSupabase.auth.getSession();

    if (
      erroSessao ||
      !sessaoAtual.session ||
      chaveRegistroPlanoStorage !==
        "barber-house:pagamento-pendente:" + sessaoAtual.session.user.id
    ) {
      registroPlanoPreparado = false;
      mensagemPlano.textContent =
        "Sua sessão mudou. Faça login novamente antes de verificar este pagamento.";
      return;
    }

    const { data, error } = await clienteSupabase.rpc(
      "registrar_pagamento_plano",
      {
        p_nome_cliente: operacao.nome,
        p_telefone: operacao.telefone,
        p_plano_id: operacao.planoId,
        p_forma_pagamento: operacao.forma,
        p_pagamento_recebido: true,
        p_chave_operacao: operacao.chave,
      },
    );

    if (error) {
      console.error("Erro ao registrar pagamento:", error);

      if (erroPlanoPermiteCorrecao(error)) {
        limparOperacaoPlano(operacao.chave);
        operacaoPlanoPendente = null;
        pagamentoPlanoRecebido.checked = false;
        mensagemPlano.textContent = error.message;
      } else {
        mensagemPlano.textContent =
          "Não foi possível confirmar o resultado. Use 'Verificar pagamento anterior' para consultar o mesmo registro.";
      }

      return;
    }

    const resultado = Array.isArray(data) && data.length === 1 ? data[0] : null;
    const dataValida = /^\d{4}-\d{2}-\d{2}$/;

    if (
      !resultado ||
      !resultado.pagamento_id ||
      !resultado.assinatura_id ||
      typeof resultado.plano !== "string" ||
      !Number.isFinite(Number(resultado.valor_pago)) ||
      Number(resultado.valor_pago) <= 0 ||
      !dataValida.test(resultado.data_inicio_vigencia) ||
      !dataValida.test(resultado.data_fim_vigencia)
    ) {
      throw new Error("Resposta do pagamento incompleta.");
    }

    pagamentoConfirmado = true;

    const texto =
      (resultado.renovacao_antecipada ? "Renovação registrada. " : "Plano ativado. ") +
      resultado.plano + " — " + moedaPlano.format(Number(resultado.valor_pago)) +
      ". Período: " + formatarDataPlano(resultado.data_inicio_vigencia) +
      " até " + formatarDataPlano(resultado.data_fim_vigencia) + ".";

    try {
      limparOperacaoPlano(operacao.chave);
    } catch (erro) {
      console.error("Pagamento registrado, mas não foi possível limpar o registro local:", erro);
      registroPlanoPreparado = false;
      mensagemPlano.textContent =
        texto + " Recarregue a página antes de iniciar outro pagamento.";
      return;
    }

    operacaoPlanoPendente = null;
    formularioPlano.reset();
    resumoPlano.textContent = "";
    mensagemPlano.textContent = texto;
  } catch (erro) {
    console.error("Falha no registro do plano:", erro);

    mensagemPlano.textContent = pagamentoConfirmado
      ? "Pagamento registrado. Recarregue a página para conferir o resultado."
      : operacaoPlanoPendente
        ? "A confirmação não chegou. Use 'Verificar pagamento anterior' para conferir o mesmo registro."
        : "Não foi possível preparar o envio. Recarregue a página e tente novamente.";
  } finally {
    salvandoPlano = false;
    atualizarBotaoPlano();
  }
});
