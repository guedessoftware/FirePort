UPDATE "CpeModelOltProfile"
SET "genieAcsParameterMapJson" = replace(
  "genieAcsParameterMapJson",
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase'
)
WHERE "genieAcsParameterMapJson" LIKE '%InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey%';

UPDATE "AppSetting"
SET "value" = replace(
  "value",
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase'
)
WHERE "key" = 'genieAcsIntegration'
  AND "value" LIKE '%InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey%';
