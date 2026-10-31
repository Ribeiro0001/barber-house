-- Impede concluir um agendamento antes da sua data.
BEGIN;

CREATE OR REPLACE FUNCTION public.validar_data_conclusao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NEW.status = 'concluido'
     AND NEW.data > timezone('America/Sao_Paulo', now())::date
  THEN
    RAISE EXCEPTION
      'Não é possível concluir um agendamento com data futura.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.validar_data_conclusao()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_validar_data_conclusao
ON public.agendamentos;

CREATE TRIGGER trg_validar_data_conclusao
BEFORE INSERT OR UPDATE OF status, data
ON public.agendamentos
FOR EACH ROW
EXECUTE FUNCTION public.validar_data_conclusao();

COMMIT;
