# Banco de dados da Barber House

A aplicação usa PostgreSQL e Supabase Auth. O JavaScript consulta os catálogos públicos de serviços e barbeiros e chama funções do banco por `clienteSupabase.rpc(...)`.

## Estrutura versionada

O export de 25/10/2026 contém 12 tabelas, 90 colunas, 43 constraints, 17 índices associados a chaves, 6 políticas RLS, 2 triggers de tabela ativos e 16 funções no esquema `public`.

A migração inicial reconstrói os objetos da aplicação e seus privilégios. Ela inclui 15 funções. A função `rls_auto_enable` e o event trigger `ensure_rls`, presentes no export, pertencem à configuração de infraestrutura observada no projeto e ficam registrados no snapshot. A migração habilita RLS explicitamente nas 12 tabelas, sem reinstalar esse mecanismo global.

| Caminho | Conteúdo |
| --- | --- |
| `migrations/20261025000000_estrutura_inicial.sql` | Tabelas, identidades, constraints, funções, triggers, RLS e grants dos objetos da aplicação. |
| `snapshots/20261025_funcoes.sql` | As 16 definições exportadas, com corpos preservados. |
| `snapshots/20261025_metadados.json` | Estrutura e permissões extraídas dos catálogos do PostgreSQL. |
| `snapshots/20261025_politicas_fornecidas.sql` | As duas políticas fornecidas inicialmente pelo autor, também confirmadas no export de metadados. |
| `consultas/exportar_metadados.sql` | Consulta de leitura usada para obter o estado do banco. |
| `tests/` | Testes de recriação e fluxos em PostgreSQL em memória, usando PGlite. |

Os arquivos SQL e JSON não contêm registros de clientes, contas, agendamentos ou pagamentos. O snapshot de funções, isoladamente, não é um instalador: a migração resolve a ordem das dependências.

## Modelo de dados

| Tabela | Responsabilidade |
| --- | --- |
| `barbeiros` | Profissionais e contatos. |
| `servicos` | Serviços, preços, duração e pontuação. |
| `horarios_trabalho` | Expediente de cada profissional por dia da semana. |
| `bloqueios` | Períodos de indisponibilidade. |
| `agendamentos` | Reservas e estado dos atendimentos. |
| `atendimentos` | Histórico de serviços concluídos. |
| `perfis` | Vínculo entre Supabase Auth, administrador e barbeiro. |
| `clientes` | Clientes associados aos planos. |
| `planos` | Catálogo de planos mensais. |
| `plano_servicos` | Descontos por serviço em cada plano. |
| `assinaturas` | Plano contratado e período de vigência. |
| `pagamentos_planos` | Pagamento por assinatura e mês de referência. |

## Regras no banco

- `criar_agendamento` obtém duração, preço e pontos do serviço e valida o profissional, a categoria e a data.
- Para planos, verifica assinatura ativa, vigência, pagamento mensal e desconto do serviço.
- `criar_agendamento_com_resumo` retorna o preço normal, o desconto e o valor cobrado para a interface.
- O trigger `trg_validar_novo_agendamento` roda antes de cada inserção e valida expediente, bloqueios e sobreposição.
- O trigger `trg_registrar_atendimento_concluido` registra a conclusão no histórico, protegido por uma chave única de agendamento.
- As funções do painel verificam perfil ativo e restringem ações ao administrador ou ao barbeiro responsável.
- O ranking considera os atendimentos do mês no fuso `America/Sao_Paulo`.

## Preparar um banco de desenvolvimento vazio

1. Crie um novo projeto Supabase para desenvolvimento. Ele fornece `auth.users`, `auth.uid()` e os papéis `anon`, `authenticated` e `service_role`.
2. No SQL Editor desse projeto novo, execute `migrations/20261025000000_estrutura_inicial.sql` como `postgres` ou pelo mecanismo padrão de migrations do Supabase, que usa esse proprietário.
3. Cadastre dados de demonstração para serviços, barbeiros, expediente e planos. A migração cria a estrutura sem copiar os dados do projeto original.
4. Crie uma conta no Supabase Auth e, como proprietário do banco, associe seu UUID a um perfil administrativo ativo em `public.perfis`.
5. Configure a URL e a chave pública do novo projeto em `js/supabase.js` e execute o frontend com um servidor estático.

Esta migração inicial destina-se a um esquema sem as tabelas da aplicação. No projeto que já está funcionando, ela serve como baseline versionada; não deve ser executada novamente. O vínculo com o histórico remoto do Supabase CLI precisa ser feito separadamente antes de usar `db push` naquele projeto.

Os grants por objeto foram preservados do export, incluindo privilégios amplos como `TRUNCATE`, `REFERENCES`, `TRIGGER` e `MAINTAIN` em algumas tabelas. RLS não substitui a revisão desses privilégios. As configurações globais, os defaults de papéis gerenciados, o conteúdo de Auth e as extensões do serviço ficam sob administração do Supabase.

As funções antigas `listar_agendamentos_admin` e `listar_ranking_mensal` não verificam o usuário em seus corpos, mas o export confirma que `anon` e `authenticated` não podem executá-las. A migração preserva essa restrição.

## Validação local

Com Node.js e npm disponíveis, execute a partir da raiz do repositório:

```sh
npm ci --prefix supabase/tests
npm test --prefix supabase/tests
```

Os testes usam PostgreSQL 18.6 via PGlite 0.5.11 em memória. O banco de origem informado pelo export é PostgreSQL 17.6. Um adaptador mínimo de `auth.users` e `auth.uid()` é criado somente no banco descartável dos testes.

A verificação confere tabelas, colunas, constraints, índices, identidades, políticas, triggers e privilégios dos papéis em relação ao export. Também executa 28 verificações de fluxo, incluindo:

- Catálogos públicos com somente registros ativos e bloqueio de acesso direto a clientes.
- Restrição de funções privadas para visitantes.
- Agendamento válido, sobreposição, expediente e data passada.
- Criação e desativação de bloqueios.
- Acesso ao painel e alteração de status por profissional.
- Registro único de conclusão e atualização do ranking.
- Desconto de plano pago e rejeição de plano sem pagamento confirmado.
- Liberação de horário após cancelamento.

Essa validação não cobre emissão de tokens pelo Supabase Auth, chamadas pela API HTTP, interface no navegador ou concorrência entre conexões. Essas etapas continuam pendentes em um projeto Supabase de desenvolvimento. Os testes não se conectam ao projeto remoto.

## Atualizar o export

Execute `consultas/exportar_metadados.sql` em uma nova consulta no SQL Editor e exporte o resultado como CSV. A coluna `estrutura` contém o JSON com as definições e permissões. As funções são exportadas separadamente com `pg_get_functiondef`.

Os próximos ajustes do banco devem ser registrados em novas migrations, mantendo a migração inicial como registro do estado recebido.
