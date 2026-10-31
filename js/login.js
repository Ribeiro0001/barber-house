const formularioLogin = document.getElementById("form-login");

const campoEmail = document.getElementById("email");

const campoSenha = document.getElementById("senha");

const mensagemLogin = document.getElementById("mensagem-login");

const botaoEntrar = formularioLogin.querySelector('button[type="submit"]');

async function verificarSessaoExistente() {
  try {
    const { data, error } = await clienteSupabase.auth.getSession();

    if (error) {
      console.error("Erro ao consultar sessão:", error);
      return;
    }

    if (data.session) {
      window.location.replace("agenda.html");
    }
  } catch (erro) {
    console.error("Não foi possível consultar a sessão:", erro);
  }
}

verificarSessaoExistente();

formularioLogin.addEventListener("submit", async function (evento) {
  evento.preventDefault();

  const emailDigitado = campoEmail.value.trim();
  const senhaDigitada = campoSenha.value;

  mensagemLogin.textContent = "Entrando...";
  botaoEntrar.disabled = true;

  const { error } = await clienteSupabase.auth.signInWithPassword({
    email: emailDigitado,
    password: senhaDigitada,
  });

  if (error) {
    console.error("Erro no login:", error);

    mensagemLogin.textContent = "E-mail ou senha incorretos.";
    botaoEntrar.disabled = false;

    return;
  }

  window.location.replace("agenda.html");
});
