ALTER TABLE "ErpLink" ADD COLUMN "pppoePassword" TEXT;

UPDATE "OltProfile"
SET "provisioningCommands" = 'configure terminal
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
write'
WHERE "id" = 'default-zte-c650';
