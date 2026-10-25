# Barber House

Sistema web de agendamento e acompanhamento de atendimentos para uma barbearia real. Projeto em desenvolvimento, com frontend em HTML, CSS e JavaScript e backend gerenciado no Supabase.

## Problema e proposta

Os atendimentos e planos eram registrados em um caderno, enquanto os agendamentos ficavam em outro aplicativo. A proposta é reunir agenda, planos e acompanhamento da produtividade em um único sistema.

## Implementação atual

- Página pública com planos mensais e formulário de agendamento.
- Catálogos de serviços e barbeiros carregados do PostgreSQL.
- Consulta de horários disponíveis por serviço, profissional e data.
- Agendamento avulso ou pelo plano, com cálculo do valor no banco.
- Login por e-mail e senha usando Supabase Auth.
- Painel com filtros por data, profissional e status.
- Conclusão e cancelamento de agendamentos por funções do banco.
- Ranking de pontos e formulário para cadastrar bloqueios de horários.
- Interface adaptada para computador e celular.

As funções SQL incluem regras de assinatura, pagamento mensal, duração do serviço e acesso por perfil. Dois triggers ativos validam novos agendamentos e registram atendimentos concluídos. A estrutura exportada e a migração inicial estão documentadas em [supabase/](supabase/README.md).

## Tecnologias e responsabilidades

| Tecnologia | Uso no projeto |
| --- | --- |
| HTML e CSS | Estrutura das páginas, formulários e layout responsivo. |
| JavaScript | Eventos, validações de interface, filtros e exibição dos dados. |
| Supabase Auth | Autenticação e sessão dos usuários do painel. |
| Supabase JS | Consultas às tabelas e chamadas de funções com `rpc()`. |
| PostgreSQL | Persistência dos dados relacionais e políticas de acesso. |
| SQL e PL/pgSQL | Consultas, funções, regras de agendamento e funções de trigger. |

Os dados de negócio ficam no PostgreSQL. O projeto não possui um servidor Node.js próprio nesta versão.

## Organização do código

| Caminho | Responsabilidade |
| --- | --- |
| `index.html` | Página pública e formulário de agendamento. |
| `login.html` | Autenticação da equipe. |
| `agenda.html` | Painel de atendimentos, ranking e bloqueios. |
| `css/style.css` | Estilos das páginas. |
| `js/supabase.js` | Configuração do cliente Supabase. |
| `js/agendamento.js` | Catálogos, horários e envio do agendamento. |
| `js/login.js` | Envio das credenciais e tratamento do login. |
| `js/agenda.js` | Sessão, perfil, filtros e ações do painel. |
| `supabase/` | Definições SQL exportadas e documentação do banco. |

## Executar o frontend

1. Clone o repositório e abra a pasta no VS Code.
2. Configure em `js/supabase.js` a URL e a chave pública de um projeto Supabase com o banco correspondente.
3. Sirva a pasta com uma ferramenta como Live Server e abra `index.html`.
4. Para acessar o painel, utilize um usuário do Supabase Auth associado a um perfil ativo em `public.perfis`.

O cliente Supabase JS é carregado por CDN e exige conexão com a internet. A chave utilizada no navegador deve ser pública; chaves secretas e credenciais do banco ficam fora do frontend.

Para preparar um banco de desenvolvimento vazio, siga as instruções de [instalação e testes do banco](supabase/README.md). A migração inicial inclui 12 tabelas, 90 colunas, 43 constraints, 15 funções da aplicação, 2 triggers e 6 políticas RLS. Sua recriação e os principais fluxos foram testados em um PostgreSQL local em memória, com dados fictícios.

## Próximas entregas

- Validar a migração em um novo projeto Supabase, incluindo autenticação real e chamadas HTTP.
- Revisar os privilégios amplos preservados do banco original e testar concorrência entre agendamentos e bloqueios.
- Corrigir a montagem da confirmação pelo WhatsApp após o agendamento.
- Conectar a listagem e a desativação de bloqueios às funções que já existem no banco.
- Evoluir o controle dos planos e a distribuição dos valores entre os barbeiros.
