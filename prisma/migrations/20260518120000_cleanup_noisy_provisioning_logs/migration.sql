DELETE FROM "ProvisioningLog"
WHERE
  lower("level") <> 'error'
  AND lower(COALESCE("stage", '') || ' ' || COALESCE("message", '') || ' ' || COALESCE("details", '')) NOT LIKE '% los %'
  AND lower(COALESCE("stage", '') || ' ' || COALESCE("message", '') || ' ' || COALESCE("details", '')) NOT LIKE '%"los"%'
  AND lower("stage") NOT IN (
    'provisioning.created',
    'provisioning.reassigned',
    'provisioning.reused',
    'port.reserved',
    'port.reserve_failed',
    'olt.registration_started',
    'olt.registration_finished',
    'olt.registration.success',
    'olt.retry_started',
    'olt.retry_finished',
    'olt.retry_skipped',
    'olt.pon.position_configured',
    'olt.pon.position_selected',
    'olt.authorization.success',
    'olt.authorization.skipped',
    'olt.provisioning.success',
    'olt.deprovision.requested',
    'olt.deprovision.finished',
    'olt.deprovision.success',
    'hubsoft.port.reserve_finished',
    'hubsoft.port.rollback_started',
    'hubsoft.port.rollback_local_finished',
    'billing.service.activated',
    'billing.service.canceled',
    'import.csv.created',
    'import.csv.onu_lookup_matched'
  )
  AND NOT (
    lower("level") = 'warn'
    AND (
      lower("stage") LIKE '%failed%'
      OR lower("stage") LIKE '%failure%'
      OR lower("stage") LIKE '%blocked%'
      OR lower("stage") LIKE '%missing%'
      OR lower("stage") LIKE '%unavailable%'
      OR lower("stage") LIKE '%occupied%'
      OR lower("stage") LIKE '%empty%'
      OR lower("stage") LIKE '%validation_failed%'
      OR lower("stage") LIKE '%cancel_failed%'
      OR lower("stage") LIKE '%activation_failed%'
    )
    AND lower("stage") NOT LIKE '%lookup%'
    AND lower("stage") NOT LIKE '%precheck%'
    AND lower("stage") NOT LIKE '%refresh%'
    AND lower("stage") NOT LIKE '%pon_query%'
    AND lower("stage") NOT LIKE '%snmp%'
  );
