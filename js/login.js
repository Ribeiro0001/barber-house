const formularioLogin = document.getElementById("form-login");

const campoUsuario = document.getElementById("usuario");

const campoSenha = document.getElementById("senha");

const mensagemLogin = document.getElementById("mensagem-login");

const usuarioCorreto = "admin";

const senhaCorreta = "1234";

formularioLogin.addEventListener("submit", function (evento) {
  evento.preventDefault();

  const usarioDigitado = campoUsuario.value.trim();

  const senhaDigitada = campoSenha.value;

  if (usarioDigitado === usuarioCorreto && senhaDigitada === senhaCorreta) {
    sessionStorage.setItem("usuarioLogado", "true");

    window.location.href = "agenda.html";

    return;
  }
  mensagemLogin.textContent = "Usuário ou senha incorretos.";
});
