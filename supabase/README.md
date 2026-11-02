# Banco de dados da Barber House

A aplicação usa PostgreSQL e Supabase Auth. O JavaScript consulta os catálogos públicos de serviços e barbeiros e chama funções do banco por `clienteSupabase.rpc(...)`.

## Estrutura versionada

O export de 25/10/2026 contém 12 tabelas, 90 colunas, 43 constraints, 17 índices associados a chaves, 6 políticas RLS, 2 triggers de tabela ativos e 16 funções no esquema `public`.

A migração inicial reconstrói os objetos da aplicação e seus privilégios. Ela inclui 15 funções. A função `rls_auto_enable` e o event trigger `ensure_rls`, presentes no export, pertencem à configuração de infraestrutura observada no projeto e ficam registrados no snapshot. A migração habilita RLS explicitamente nas 12 tabelas, sem reinstalar esse mecanismo global.

| Caminho | Conteúdo |
| --- | --- |
| `migrations/20261025000000_estrutura_inicial.sql` | Tabelas, identidades, constraints, funções, triggers, RLS e grants dos objetos da aplicação. |
| `migrations/20261031000000_ranking_apenas_planos.sql` | Ranking mensal restrito aos atendimentos de plano. |
| `migrations/20261031010000_conclusao_com_adicionais.sql` | Registro dos adicionais e validação do plano na conclusão. |
| `migrations/20261031020000_bloquear_conclusao_futura.sql` | Impede concluir uma reserva antes da data agendada. |
| `migrations/20261031030000_planos_vigencia_30_dias.sql` | Vigência por pagamento, ativação e renovação de 30 dias. |
| `snapshots/20261025_funcoes.sql` | As 16 definições exportadas, com corpos preservados. |
| `snapshots/20261025_metadados.json` | Estrutura e permissões extraídas dos catálogos do PostgreSQL. |
| `snapshots/20261025_politicas_fornecidas.sql` | As duas políticas fornecidas inicialmente pelo autor, também confirmadas no export de metadados. |
| `consultas/exportar_metadados.sql` | Consulta de leitura usada para obter o estado do banco. |
| `tests/` | Testes de recriação e fluxos em PostgreSQL em memória, usando PGlite. |

Os snapshots SQL e JSON contêm definições da estrutura. A migração de vigência inclui uma atualização condicionada ao único pagamento legado previamente conferido, preservando seu valor e as datas cadastradas. O snapshot de funções, isoladamente, não é um instalador: a migração resolve a ordem das dependências.

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
| `pagamentos_planos` | Pagamento, período coberto, responsável pelo registro e identificação única da operação; mês de referência para fechamento. |

## Regras no banco

- `criar_agendamento` obtém duração, preço e pontos do serviço e valida o profissional, a categoria e a data.
- Para planos, verifica assinatura ativa, vigência, pagamento confirmado que cubra a data agendada e desconto do serviço.
- `criar_agendamento_com_resumo` retorna o preço normal, o desconto e o valor cobrado para a interface.
- O trigger `trg_validar_novo_agendamento` roda antes de cada inserção e valida expediente, bloqueios e sobreposição.
- O trigger `trg_registrar_atendimento_concluido` registra a conclusão no histórico, protegido por uma chave única de agendamento.
- As funções do painel verificam perfil ativo e restringem ações ao administrador ou ao barbeiro responsável.
- O ranking considera somente os atendimentos de plano concluídos no mês, no fuso `America/Sao_Paulo`. Pontos de avulsos são zerados na conclusão.
- Os adicionais de pezinho, barba e sobrancelha ficam registrados; itens já incluídos no serviço base são recusados.
- A conclusão revalida a assinatura e o período pago para a data atual. Reservas futuras não podem ser concluídas.


## Ativação e renovação por período

A vigência usa datas inclusivas no fuso de São Paulo. Uma nova ativação começa hoje e termina em hoje + 29 dias: são 30 dias contando o dia da ativação. A renovação antecipada do mesmo plano começa no dia seguinte ao último dia válido e soma mais 30 dias. Após o vencimento, um novo período começa na confirmação do novo pagamento.

Cada pagamento possui `vigencia_inicio` e `vigencia_fim`. A renovação mantém os períodos de pagamentos anteriores, mesmo ao estender a assinatura. `mes_referencia` acompanha o mês em que o pagamento foi registrado e deixa de limitar o uso do plano na virada do mês.

A migração preserva a assinatura legada de 02/10/2026 a 02/11/2026, sem encurtá-la para 30 dias. O preenchimento legado só acontece se identificadores, datas e valor corresponderem ao registro conferido. Outro pagamento confirmado sem período conhecido interrompe a migração; sua vigência deve ser conferida antes da aplicação. Um banco de desenvolvimento vazio também pode aplicar a migração.

Qualquer perfil ativo de administrador ou barbeiro pode usar:

- `listar_planos_painel()`: lista planos ativos e seus preços.
- `registrar_pagamento_plano(p_nome_cliente, p_telefone, p_plano_id, p_forma_pagamento, p_pagamento_recebido, p_chave_operacao)`: registra um pagamento recebido e ativa ou renova o plano. O valor vem do catálogo no banco, e a confirmação de recebimento deve ser verdadeira.

O telefone é normalizado para os dígitos nacionais com DDD, aceitando o prefixo brasileiro +55. Cadastros duplicados após essa normalização exigem correção. A função registra quem confirmou o pagamento; ela não processa Pix, cartão ou transferência bancária.

A interface deve gerar um UUID por pagamento com `crypto.randomUUID()` e manter a mesma `p_chave_operacao` quando repetir uma solicitação cujo resultado não chegou. Repetir a mesma operação retorna o pagamento já registrado. Uma chave reaproveitada com outro cliente, plano, forma de pagamento ou usuário é recusada.

A função usa bloqueios durante o registro e permite várias renovações no mesmo mês. A troca de plano durante uma vigência ativa permanece bloqueada, pois proporcionalidade e mudança de cobertura ainda não foram definidas.

O cadastro de ativação/renovação na interface, a cobrança dos adicionais e o fluxo de agendamento com renovação pendente continuam sendo etapas separadas. O agendamento online ainda exige cobertura para a data selecionada.

## Preparar um banco de desenvolvimento vazio

1. Crie um novo projeto Supabase para desenvolvimento. Ele fornece `auth.users`, `auth.uid()` e os papéis `anon`, `authenticated` e `service_role`.
2. No SQL Editor desse projeto novo, execute todas as migrations em ordem de nome, começando por `migrations/20261025000000_estrutura_inicial.sql`, como `postgres` ou pelo mecanismo padrão de migrations do Supabase, que usa esse proprietário.
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

A verificação confere tabelas, colunas, constraints, índices, identidades, políticas, triggers e privilégios dos papéis em relação ao export. O teste `validar_banco.cjs` mantém a comparação da migração inicial com o snapshot e executa 28 verificações de fluxo desse estado original, incluindo:

- Catálogos públicos com somente registros ativos e bloqueio de acesso direto a clientes.
- Restrição de funções privadas para visitantes.
- Agendamento válido, sobreposição, expediente e data passada.
- Criação e desativação de bloqueios.
- Acesso ao painel e alteração de status por profissional.
- Registro único de conclusão e atualização do ranking.
- Desconto de plano pago e rejeição de plano sem pagamento confirmado.
- Liberação de horário após cancelamento.

`validar_planos_30_dias.cjs` aplica as migrations seguintes com dados fictícios e executa outras 36 verificações: preservação do legado, novas vigências, renovação antecipada e após vencimento, várias renovações no mesmo mês, agendamento na virada do mês, validação na conclusão, repetição da operação, normalização de telefone, preços e permissões. Uma verificação também confirma que pagamentos legados desconhecidos interrompem a migração com rollback.

Essa validação não cobre emissão de tokens pelo Supabase Auth, chamadas pela API HTTP, interface no navegador ou concorrência entre conexões. Essas etapas continuam pendentes em um projeto Supabase de desenvolvimento. Os testes não se conectam ao projeto remoto.

## Atualizar o export

Execute `consultas/exportar_metadados.sql` em uma nova consulta no SQL Editor e exporte o resultado como CSV. A coluna `estrutura` contém o JSON com as definições e permissões. As funções são exportadas separadamente com `pg_get_functiondef`.

Os próximos ajustes do banco devem ser registrados em novas migrations, mantendo a migração inicial como registro do estado recebido.
