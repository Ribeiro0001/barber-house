-- Catálogo confirmado: cinco planos, com os preços e coberturas vigentes.
-- Preserva IDs dos planos antigos, assinaturas e pagamentos registrados.
BEGIN;

ALTER TABLE public.planos ADD COLUMN IF NOT EXISTS codigo text;

UPDATE public.planos
SET codigo=CASE regexp_replace(lower(btrim(nome)),'[^[:alnum:]]','','g')
  WHEN 'essencial' THEN 'cabelo'
  WHEN 'cabelo' THEN 'cabelo'
  WHEN 'corte' THEN 'cabelo'
  WHEN 'clássico' THEN 'cabelo_sobrancelha'
  WHEN 'classico' THEN 'cabelo_sobrancelha'
  WHEN 'cabeloesobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'cabelosobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'corteesobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'cortesobrancelha' THEN 'cabelo_sobrancelha'
  WHEN 'cabeloebarba' THEN 'cabelo_barba'
  WHEN 'cabelobarba' THEN 'cabelo_barba'
  WHEN 'corteebarba' THEN 'cabelo_barba'
  WHEN 'cortebarba' THEN 'cabelo_barba'
  WHEN 'premium' THEN 'completo'
  WHEN 'completo' THEN 'completo'
  WHEN 'cabelobarbaesobrancelha' THEN 'completo'
  WHEN 'cabeloebarbaesobrancelha' THEN 'completo'
  WHEN 'cabelobarbasobrancelha' THEN 'completo'
  WHEN 'cortebarbaesobrancelha' THEN 'completo'
  WHEN 'cortebarbasobrancelha' THEN 'completo'
  WHEN 'barba' THEN 'barba'
  ELSE NULL END
WHERE codigo IS NULL;

DO $guard$
BEGIN
  IF EXISTS(SELECT codigo FROM public.planos WHERE codigo IS NOT NULL
    GROUP BY codigo HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Há planos duplicados para a mesma cobertura. Revise os IDs antes de atualizar o catálogo.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.planos WHERE ativo AND
    (codigo IS NULL OR codigo NOT IN ('cabelo','cabelo_barba','cabelo_sobrancelha','completo','barba'))) THEN
    RAISE EXCEPTION 'Há um plano ativo não identificado no catálogo de cinco planos. Revise o cadastro.';
  END IF;
END;
$guard$;

CREATE UNIQUE INDEX IF NOT EXISTS planos_codigo_unico ON public.planos(codigo);

CREATE OR REPLACE FUNCTION public.validar_cobertura_plano()
RETURNS trigger LANGUAGE plpgsql SET search_path TO public
AS $function$
BEGIN
  IF cardinality(NEW.componentes_incluidos)=0 THEN
    NEW.componentes_incluidos := CASE NEW.codigo
      WHEN 'cabelo' THEN ARRAY['corte']
      WHEN 'cabelo_barba' THEN ARRAY['corte','barba']
      WHEN 'cabelo_sobrancelha' THEN ARRAY['corte','sobrancelha']
      WHEN 'completo' THEN ARRAY['corte','barba','sobrancelha']
      WHEN 'barba' THEN ARRAY['barba']
      ELSE NEW.componentes_incluidos END;
  END IF;
  IF NEW.ativo AND cardinality(NEW.componentes_incluidos)=0 THEN
    RAISE EXCEPTION 'Configure os serviços incluídos antes de ativar o plano.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.validar_cobertura_plano()
FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO public.planos(codigo,nome,preco_mensal,descricao,componentes_incluidos,ativo)
VALUES
  ('cabelo','Cabelo',59.90,'Cortes de cabelo ilimitados por 30 dias.',ARRAY['corte'],true),
  ('cabelo_barba','Cabelo e Barba',89.90,'Cabelo e barba ilimitados por 30 dias.',ARRAY['corte','barba'],true),
  ('cabelo_sobrancelha','Cabelo e Sobrancelha',79.90,'Cabelo e sobrancelha ilimitados por 30 dias.',ARRAY['corte','sobrancelha'],true),
  ('completo','Cabelo, Barba e Sobrancelha',99.90,'Cabelo, barba e sobrancelha ilimitados por 30 dias.',ARRAY['corte','barba','sobrancelha'],true),
  ('barba','Barba',49.90,'Barbas ilimitadas por 30 dias.',ARRAY['barba'],true)
ON CONFLICT(codigo) DO UPDATE SET
  nome=excluded.nome,
  preco_mensal=excluded.preco_mensal,
  descricao=excluded.descricao,
  componentes_incluidos=excluded.componentes_incluidos,
  ativo=true;

-- Sincroniza a tabela de descontos usada nas consultas administrativas.
-- O cálculo de agendamento também usa diretamente a cobertura do plano.
DELETE FROM public.plano_servicos AS ps
USING public.planos AS pl,public.servicos AS s
WHERE ps.plano_id=pl.id AND ps.servico_id=s.id
  AND pl.codigo IN ('cabelo','cabelo_barba','cabelo_sobrancelha','completo','barba')
  AND cardinality(public.componentes_do_servico(s.nome))>0
  AND NOT(public.componentes_do_servico(s.nome) && pl.componentes_incluidos);

INSERT INTO public.plano_servicos(plano_id,servico_id,valor_desconto)
SELECT pl.id,s.id,public.desconto_coberto_do_servico(s.id,pl.id)
FROM public.planos AS pl CROSS JOIN public.servicos AS s
WHERE pl.codigo IN ('cabelo','cabelo_barba','cabelo_sobrancelha','completo','barba')
  AND public.componentes_do_servico(s.nome) && pl.componentes_incluidos
ON CONFLICT(plano_id,servico_id) DO UPDATE SET valor_desconto=excluded.valor_desconto;

COMMIT;
