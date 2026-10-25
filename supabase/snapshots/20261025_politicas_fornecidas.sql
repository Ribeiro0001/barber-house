-- Políticas fornecidas pelo autor em 2026-10-25.
-- Origem: consulta salva no SQL Editor; o estado atual ainda será confirmado.
-- Dependem da existência das tabelas, dos grants e da ativação de RLS.
-- Os comandos CREATE POLICY pressupõem que essas políticas ainda não existem.

create policy "publico_visualiza_barbeiros_ativos"
on public.barbeiros
for select
to anon, authenticated
using (ativo = true);

create policy "publico_visualiza_servicos_ativos"
on public.servicos
for select
to anon, authenticated
using (ativo = true);
