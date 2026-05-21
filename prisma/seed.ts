import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const defaultAuthorizationCommands = `conf t
interface gpon_olt-[[chassi]]/[[slot]]/[[pon]]
onu [[indice_onu]] type [[onu_type]] sn [[phy_addr]]
exit`

const defaultProvisioningCommands = `configure terminal
interface gpon_onu-[[chassi]]/[[slot]]/[[pon]]:[[indice_onu]]
tcont 1 profile 1G
gemport 1 tcont 1
gemport 2 tcont 1
exit
interface vport-[[chassi]]/[[slot]]/[[pon]].[[indice_onu]]:1
service-port 1 user-vlan 600 vlan [[vlan]]
exit
interface vport-[[chassi]]/[[slot]]/[[pon]].[[indice_onu]]:2
service-port 2 user-vlan 998 vlan 998
exit
pon-onu-mng gpon_onu-[[chassi]]/[[slot]]/[[pon]]:[[indice_onu]]
service 1 gemport 1 vlan 600
service 2 gemport 2 vlan 998
wan-ip 1 ipv4 mode dhcp vlan-profile 998 host 1
wan-ip 2 ipv4 mode pppoe username [[login]] password [[senha]] vlan-profile 600 host 2
wan-ip ipv4 ping-response enable traceroute-response enable
security-mgmt 1 ingress-type wan state enable mode forward protocol https web
tr069-mgmt 1 acs http://tr069.firecdn.com.br:7547 tag pri 0 vlan 998
exit
exit
write`

const defaultRemovalCommands = `configure terminal
interface gpon_olt-[[chassi]]/[[slot]]/[[pon]]
no onu [[indice_onu]]
exit
exit
write`

async function main() {
  console.log('Seeding database...')

  // Create CPE models
  const models = [
    {
      id: 'model_1',
      name: 'Huawei HG8245H',
      description: 'ONT GPON padrão',
      onuType: 'HG8245H',
    },
    {
      id: 'model_2',
      name: 'ZTE-F641',
      description: 'ONT GPON ZTE',
      onuType: 'ZTE-F641',
    },
    {
      id: 'model_3',
      name: 'Nokia G-2425G-A',
      description: 'ONT GPON Nokia',
      onuType: 'G-2425G-A',
    },
    {
      id: 'model_4',
      name: 'FiberHome HG6242D',
      description: 'ONT GPON FiberHome',
      onuType: 'HG6242D',
    },
  ]

  for (const model of models) {
    const cpeModel = { id: model.id, name: model.name, description: model.description }
    await prisma.cPEModel.upsert({
      where: { id: model.id },
      update: cpeModel,
      create: cpeModel,
      select: { id: true },
    })
  }

  console.log(`Created ${models.length} CPE models`)

  for (const model of models) {
    await prisma.$executeRaw`
      INSERT INTO "CpeModelOltProfile" (
        "id",
        "cpeModelId",
        "oltManufacturer",
        "oltModel",
        "oltDriver",
        "onuType",
        "authorizationCommands",
        "provisioningCommands",
        "deprovisioningCommands",
        "deauthorizationCommands",
        "tr069Commands",
        "genieAcsParameterMapJson",
        "requiredVariablesJson",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${`${model.id}_zte_c650`},
        ${model.id},
        'ZTE',
        'C650',
        'zte-c650',
        ${model.onuType},
        ${defaultAuthorizationCommands},
        ${defaultProvisioningCommands},
        ${defaultRemovalCommands},
        ${null},
        ${null},
        ${JSON.stringify({
          serialParameter: 'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_GPONSN',
          wifiSsidParameter: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
          wifiPasswordParameter: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase',
          wifi5SsidParameter: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
          wifi5PasswordParameter: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase',
          hostsObjectPath: 'InternetGatewayDevice.LANDevice.1.Hosts.Host',
          wifi24AssociatedDevicePath: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice',
          wifi5AssociatedDevicePath: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice',
        })},
        ${JSON.stringify(['vlan', 'chassi', 'slot', 'pon', 'indice_onu', 'phy_addr', 'onu_type'])},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT("cpeModelId", "oltManufacturer", "oltModel", "oltDriver") DO UPDATE SET
        "onuType" = excluded."onuType",
        "authorizationCommands" = excluded."authorizationCommands",
        "provisioningCommands" = excluded."provisioningCommands",
        "deprovisioningCommands" = excluded."deprovisioningCommands",
        "genieAcsParameterMapJson" = excluded."genieAcsParameterMapJson",
        "requiredVariablesJson" = excluded."requiredVariablesJson",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  }

  console.log('Created default CPE x OLT compatibility profiles')

  // Create test CTOs with coordinates
  const ctos = [
    { id: 'cto_1', name: 'CTO Centro', address: 'Av. Brasil, 100 - Centro', lat: -2.9857, lng: -60.0031, hubsoftId: 'hub_1' },
    { id: 'cto_2', name: 'CTO Norte', address: 'Av. Norte, 200 - Norte', lat: -2.9800, lng: -60.0000, hubsoftId: 'hub_2' },
    { id: 'cto_3', name: 'CTO Sul', address: 'Av. Sul, 300 - Sul', lat: -2.9900, lng: -60.0100, hubsoftId: 'hub_3' },
  ]

  for (const cto of ctos) {
    const createdCto = await prisma.cTO.upsert({
      where: { id: cto.id },
      update: cto,
      create: cto,
    })

    // Create ports for each CTO
    for (let i = 1; i <= 8; i++) {
      await prisma.port.upsert({
        where: { id: `${cto.id}_port_${i}` },
        update: { number: i, status: 'available' },
        create: { id: `${cto.id}_port_${i}`, number: i, status: 'available', ctoId: createdCto.id },
      })
    }
    console.log(`Created CTO ${cto.name} with 8 ports`)
  }

  console.log('Database seeded successfully!')
}

main()
  .catch((e) => {
    console.error('Seed error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
