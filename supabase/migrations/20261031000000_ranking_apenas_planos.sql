-- Ranking mensal: considera apenas atendimentos de plano.
BEGIN;

CREATE OR REPLACE FUNCTION public.listar_ranking_pontos()
RETURNS TABLE(
  posicao bigint,
  barbeiro_id bigint,
  barbeiro_nome text,
  total_atendimentos bigint,
  total_pontos bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ranking AS (
    SELECT
      b.id AS barbeiro_id,
      b.nome AS barbeiro_nome,
      count(a.id) AS total_atendimentos,
      coalesce(sum(a.pontos_gerados), 0)::bigint AS total_pontos
    FROM public.barbeiros AS b
    LEFT JOIN public.atendimentos AS a
      ON a.barbeiro_id = b.id
      AND a.categoria = 'plano'
      AND timezone('America/Sao_Paulo', a.realizado_em) >=
          date_trunc(
            'month',
            timezone('America/Sao_Paulo', now())
          )
      AND timezone('America/Sao_Paulo', a.realizado_em) <
          date_trunc(
            'month',
            timezone('America/Sao_Paulo', now())
          ) + interval '1 month'
    WHERE b.ativo = true
    GROUP BY b.id, b.nome
  )
  SELECT
    dense_rank() OVER (
      ORDER BY ranking.total_pontos DESC
    ) AS posicao,
    ranking.barbeiro_id,
    ranking.barbeiro_nome,
    ranking.total_atendimentos,
    ranking.total_pontos
  FROM ranking
  WHERE EXISTS (
    SELECT 1
    FROM public.perfis AS p
    WHERE p.usuario_id = auth.uid()
      AND p.ativo = true
  )
  ORDER BY
    ranking.total_pontos DESC,
    ranking.barbeiro_nome;
$function$;

REVOKE ALL ON FUNCTION public.listar_ranking_pontos()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.listar_ranking_pontos()
TO authenticated;

COMMIT;