#!/usr/bin/env bash

COMMUNITY="${SNMP_COMMUNITY:-public}"
HOST="${SNMP_HOST:-127.0.0.1}"

# =========================
# OIDs OLT - CPU / Memoria / Temperatura
# =========================

OID_TEMP_OLT="1.3.6.1.4.1.3902.3.6002.2.4.1.3"

OID_CPU_5S="1.3.6.1.4.1.3902.3.6002.2.1.1.7"
OID_CPU_1M="1.3.6.1.4.1.3902.3.6002.2.1.1.8"
OID_CPU_5M="1.3.6.1.4.1.3902.3.6002.2.1.1.9"
OID_CPU_PEAK="1.3.6.1.4.1.3902.3.6002.2.1.1.10"

OID_MEM_PHYSICAL="1.3.6.1.4.1.3902.3.6002.2.1.1.5"
OID_MEM_USED_PERCENT="1.3.6.1.4.1.3902.3.6002.2.1.1.6"

# Sensores / placas
OID_BOARD_TEMP_DESC="1.3.6.1.4.1.3902.3.6002.2.5.1.6"
OID_BOARD_TEMP_LOCATION="1.3.6.1.4.1.3902.3.6002.2.5.1.7"
OID_BOARD_SENSOR_STATUS="1.3.6.1.4.1.3902.3.6002.2.5.1.8"
OID_BOARD_TEMP_CURRENT="1.3.6.1.4.1.3902.3.6002.2.5.1.9"
OID_BOARD_TEMP_THRESHOLD_1="1.3.6.1.4.1.3902.3.6002.2.5.1.10"
OID_BOARD_TEMP_THRESHOLD_2="1.3.6.1.4.1.3902.3.6002.2.5.1.11"
OID_BOARD_TEMP_THRESHOLD_3="1.3.6.1.4.1.3902.3.6002.2.5.1.12"
OID_BOARD_TEMP_THRESHOLD_4="1.3.6.1.4.1.3902.3.6002.2.5.1.13"

# =========================
# Uplinks / IF-MIB
# =========================

OID_ZTE_PORT_NAME="1.3.6.1.4.1.3902.3.102.3.1.1.1"

OID_IFOPERSTATUS="1.3.6.1.2.1.2.2.1.8"

# 64-bit counters
OID_IFHCINOCTETS="1.3.6.1.2.1.31.1.1.1.6"
OID_IFHCOUTOCTETS="1.3.6.1.2.1.31.1.1.1.10"

# Fallback 32-bit counters
OID_IFINOCTETS="1.3.6.1.2.1.2.2.1.10"
OID_IFOUTOCTETS="1.3.6.1.2.1.2.2.1.16"

INTERVAL=5
MODE="all"
SNMP_TIMEOUT=3
SNMP_RETRIES=0

usage() {
  echo "Uso:"
  echo "  $0"
  echo "  $0 --host 192.0.2.10 --community public"
  echo "  $0 --mode all"
  echo "  $0 --mode summary"
  echo "  $0 --mode processor"
  echo "  $0 --mode temperature"
  echo "  $0 --mode uplinks"
  echo "  $0 --interval 10"
  echo "  $0 --timeout 3 --retries 0"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host)
      HOST="$2"
      shift 2
      ;;
    --community)
      COMMUNITY="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --timeout)
      SNMP_TIMEOUT="$2"
      shift 2
      ;;
    --retries)
      SNMP_RETRIES="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Argumento inválido: $1"
      usage
      exit 1
      ;;
  esac
done

extract_value_after_colon() {
  awk -F': ' '{print $2}'
}

extract_number_after_colon() {
  awk -F': ' '{print $2}' |
  awk '{print $1}' |
  sed -E 's/.*\(([0-9]+)\).*/\1/'
}

extract_index() {
  local oid_base="$1"
  local line="$2"
  local oid
  local idx

  oid=$(echo "$line" | awk -F' = ' '{print $1}')
  idx=$(echo "$oid" | sed "s|.*$oid_base\.||")

  if [ -z "$idx" ] || [ "$idx" = "$oid" ]; then
    echo ""
  else
    echo "$idx"
  fi
}

snmp_get_integer() {
  snmpget -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$1" 2>/dev/null |
  extract_number_after_colon
}

snmp_get_counter() {
  snmpget -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$1" 2>/dev/null |
  awk -F': ' '{print $2}' |
  awk '{print $1}'
}

oper_status_name() {
  case "$1" in
    1) echo "up" ;;
    2) echo "down" ;;
    3) echo "testing" ;;
    4) echo "unknown" ;;
    5) echo "dormant" ;;
    6) echo "notPresent" ;;
    7) echo "lowerLayerDown" ;;
    "") echo "unknown" ;;
    *) echo "unknown" ;;
  esac
}

sensor_status_name() {
  case "$1" in
    1) echo "normal" ;;
    2) echo "warning" ;;
    3) echo "critical" ;;
    4) echo "shutdown" ;;
    *) echo "unknown" ;;
  esac
}

is_oper_down() {
  case "$1" in
    down|testing|dormant|notPresent|lowerLayerDown)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

get_in_counter() {
  local ifindex="$1"
  local val

  val=$(snmp_get_counter "$OID_IFHCINOCTETS.$ifindex")

  if [ -z "$val" ]; then
    val=$(snmp_get_counter "$OID_IFINOCTETS.$ifindex")
  fi

  echo "$val"
}

get_out_counter() {
  local ifindex="$1"
  local val

  val=$(snmp_get_counter "$OID_IFHCOUTOCTETS.$ifindex")

  if [ -z "$val" ]; then
    val=$(snmp_get_counter "$OID_IFOUTOCTETS.$ifindex")
  fi

  echo "$val"
}

processor_name_from_index() {
  local idx="$1"
  local rack shelf slot cpu

  IFS="." read -r rack shelf slot cpu <<< "$idx"

  if [ "$slot" = "6" ]; then
    echo "MPU-${rack}/${slot}/${cpu}"
  else
    echo "PFU-${rack}/${slot}/${cpu}"
  fi
}

processor_role_from_index() {
  local idx="$1"
  local rack shelf slot cpu

  IFS="." read -r rack shelf slot cpu <<< "$idx"

  if [ "$slot" = "6" ]; then
    echo "MSC"
  else
    echo "N/A"
  fi
}

calc_free_mem() {
  local phymem="$1"
  local mem_percent="$2"

  awk -v phy="$phymem" -v mem="$mem_percent" 'BEGIN {
    if (phy == "" || mem == "") {
      print "";
    } else {
      printf "%.0f", phy - ((phy * mem) / 100);
    }
  }'
}

collect_summary() {
  echo "TIPO;METRICA;INDEX;VALOR"

  snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_TEMP_OLT" 2>/dev/null |
  while read -r line; do
    idx=$(extract_index "$OID_TEMP_OLT" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    echo "OLT;TEMPERATURA_OLT;$idx;$val"
  done

  snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_CPU_5S" 2>/dev/null |
  while read -r line; do
    idx=$(extract_index "$OID_CPU_5S" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    echo "CPU;CPU_5S;$idx;$val"
  done

  snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_CPU_1M" 2>/dev/null |
  while read -r line; do
    idx=$(extract_index "$OID_CPU_1M" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    echo "CPU;CPU_1M;$idx;$val"
  done

  snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_CPU_5M" 2>/dev/null |
  while read -r line; do
    idx=$(extract_index "$OID_CPU_5M" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    echo "CPU;CPU_5M;$idx;$val"
  done

  snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_CPU_PEAK" 2>/dev/null |
  while read -r line; do
    idx=$(extract_index "$OID_CPU_PEAK" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    echo "CPU;CPU_PEAK;$idx;$val"
  done

  snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_MEM_PHYSICAL" 2>/dev/null |
  while read -r line; do
    idx=$(extract_index "$OID_MEM_PHYSICAL" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    echo "MEMORIA;MEMORIA_FISICA;$idx;$val"
  done

  snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_MEM_USED_PERCENT" 2>/dev/null |
  while read -r line; do
    idx=$(extract_index "$OID_MEM_USED_PERCENT" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    echo "MEMORIA;MEMORIA_USADA_PERCENT;$idx;$val"
  done
}

collect_processor_table() {
  declare -A cpu5s
  declare -A cpu1m
  declare -A cpu5m
  declare -A peak
  declare -A phymem
  declare -A memused

  while read -r line; do
    idx=$(extract_index "$OID_CPU_5S" "$line")
    val=$(echo "$line" | extract_value_after_colon)
    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue
    cpu5s["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_CPU_5S" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_CPU_1M" "$line")
    val=$(echo "$line" | extract_value_after_colon)
    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue
    cpu1m["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_CPU_1M" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_CPU_5M" "$line")
    val=$(echo "$line" | extract_value_after_colon)
    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue
    cpu5m["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_CPU_5M" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_CPU_PEAK" "$line")
    val=$(echo "$line" | extract_value_after_colon)
    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue
    peak["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_CPU_PEAK" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_MEM_PHYSICAL" "$line")
    val=$(echo "$line" | extract_value_after_colon)
    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue
    phymem["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_MEM_PHYSICAL" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_MEM_USED_PERCENT" "$line")
    val=$(echo "$line" | extract_value_after_colon)
    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue
    memused["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_MEM_USED_PERCENT" 2>/dev/null)

  printf "%-12s %-6s %8s %8s %8s %8s %8s %8s %8s\n" \
    "Character" "Role" "CPU(5s)" "CPU(1m)" "CPU(5m)" "Peak" "PhyMem" "FreeMem" "Mem"

  printf "%-12s %-6s %8s %8s %8s %8s %8s %8s %8s\n" \
    "----------" "------" "-------" "-------" "-------" "----" "------" "-------" "---"

  for idx in $(printf "%s\n" "${!cpu5s[@]}" "${!cpu1m[@]}" "${!cpu5m[@]}" "${!peak[@]}" "${!phymem[@]}" "${!memused[@]}" | sed '/^$/d' | sort -t '.' -k3,3n -k4,4n -u); do
    character=$(processor_name_from_index "$idx")
    role=$(processor_role_from_index "$idx")
    free_mem=$(calc_free_mem "${phymem[$idx]}" "${memused[$idx]}")

    printf "%-12s %-6s %7s%% %7s%% %7s%% %7s%% %8s %8s %7s%%\n" \
      "$character" \
      "$role" \
      "${cpu5s[$idx]}" \
      "${cpu1m[$idx]}" \
      "${cpu5m[$idx]}" \
      "${peak[$idx]}" \
      "${phymem[$idx]}" \
      "$free_mem" \
      "${memused[$idx]}"
  done
}

collect_temperatures() {
  echo "TIPO;INDEX;PLACA;SENSOR;STATUS_SENSOR_CODE;STATUS_SENSOR;TEMPERATURA_C;LIMITE_1;LIMITE_2;LIMITE_3;LIMITE_4"

  declare -A boards
  declare -A sensors
  declare -A sensor_status
  declare -A temps
  declare -A limit1
  declare -A limit2
  declare -A limit3
  declare -A limit4

  while read -r line; do
    idx=$(extract_index "$OID_BOARD_TEMP_DESC" "$line")
    val=$(echo "$line" | sed -n 's/.*STRING: "\(.*\)"/\1/p')

    [ -z "$idx" ] && continue
    boards["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_BOARD_TEMP_DESC" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_BOARD_TEMP_LOCATION" "$line")
    val=$(echo "$line" | sed -n 's/.*STRING: "\(.*\)"/\1/p')

    [ -z "$idx" ] && continue
    sensors["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_BOARD_TEMP_LOCATION" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_BOARD_SENSOR_STATUS" "$line")
    val=$(echo "$line" | extract_number_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    sensor_status["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_BOARD_SENSOR_STATUS" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_BOARD_TEMP_CURRENT" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    temps["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_BOARD_TEMP_CURRENT" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_BOARD_TEMP_THRESHOLD_1" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    limit1["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_BOARD_TEMP_THRESHOLD_1" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_BOARD_TEMP_THRESHOLD_2" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    limit2["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_BOARD_TEMP_THRESHOLD_2" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_BOARD_TEMP_THRESHOLD_3" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    limit3["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_BOARD_TEMP_THRESHOLD_3" 2>/dev/null)

  while read -r line; do
    idx=$(extract_index "$OID_BOARD_TEMP_THRESHOLD_4" "$line")
    val=$(echo "$line" | extract_value_after_colon)

    [ -z "$idx" ] && continue
    [ -z "$val" ] && continue

    limit4["$idx"]="$val"
  done < <(snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_BOARD_TEMP_THRESHOLD_4" 2>/dev/null)

  for idx in $(printf "%s\n" "${!boards[@]}" "${!sensors[@]}" "${!sensor_status[@]}" "${!temps[@]}" "${!limit1[@]}" "${!limit2[@]}" "${!limit3[@]}" "${!limit4[@]}" | sed '/^$/d' | sort -t '.' -k3,3n -k4,4n -k5,5n -u); do
    status_code="${sensor_status[$idx]}"
    status_name=$(sensor_status_name "$status_code")

    echo "SENSOR;$idx;${boards[$idx]};${sensors[$idx]};$status_code;$status_name;${temps[$idx]};${limit1[$idx]};${limit2[$idx]};${limit3[$idx]};${limit4[$idx]}"
  done | sort -t ';' -k2,2
}

discover_uplinks() {
  snmpwalk -v2c -On -t "$SNMP_TIMEOUT" -r "$SNMP_RETRIES" -c "$COMMUNITY" "$HOST" "$OID_ZTE_PORT_NAME" 2>/dev/null |
  awk -F' = STRING: ' '/xgei|xei|gei|uplink/ {
    split($1,a,".");
    print a[length(a)] ";" $2
  }' |
  sed 's/"//g'
}

measure_traffic() {
  local ifindex="$1"
  local in1 out1 in2 out2 rx_mbps tx_mbps

  in1=$(get_in_counter "$ifindex")
  out1=$(get_out_counter "$ifindex")

  if [ -z "$in1" ] || [ -z "$out1" ]; then
    echo ";;"
    return
  fi

  sleep "$INTERVAL"

  in2=$(get_in_counter "$ifindex")
  out2=$(get_out_counter "$ifindex")

  if [ -z "$in2" ] || [ -z "$out2" ]; then
    echo ";;"
    return
  fi

  rx_mbps=$(awk -v a="$in1" -v b="$in2" -v s="$INTERVAL" 'BEGIN {
    if (a == "" || b == "" || s <= 0 || b < a) print "";
    else printf "%.2f", ((b - a) * 8) / s / 1000000;
  }')

  tx_mbps=$(awk -v a="$out1" -v b="$out2" -v s="$INTERVAL" 'BEGIN {
    if (a == "" || b == "" || s <= 0 || b < a) print "";
    else printf "%.2f", ((b - a) * 8) / s / 1000000;
  }')

  echo "$rx_mbps;$tx_mbps"
}

collect_uplinks() {
  echo "INTERFACE;IFINDEX;OPER_STATUS;RX_Mbps;TX_Mbps;OBS"

  while IFS=";" read -r ifindex ifname; do
    [ -z "$ifindex" ] && continue
    [ -z "$ifname" ] && continue

    oper_code=$(snmp_get_integer "$OID_IFOPERSTATUS.$ifindex")
    oper_name=$(oper_status_name "$oper_code")

    if is_oper_down "$oper_name"; then
      echo "$ifname;$ifindex;$oper_name;0.00;0.00;porta_inativa_sem_coleta_de_trafego"
      continue
    fi

    traffic=$(measure_traffic "$ifindex")
    rx_mbps=$(echo "$traffic" | awk -F';' '{print $1}')
    tx_mbps=$(echo "$traffic" | awk -F';' '{print $2}')

    if [ "$oper_name" = "up" ]; then
      echo "$ifname;$ifindex;$oper_name;$rx_mbps;$tx_mbps;porta_up_coleta_realizada"
      continue
    fi

    inferred_status=$(awk -v rx="$rx_mbps" -v tx="$tx_mbps" 'BEGIN {
      if ((rx + 0) > 0 || (tx + 0) > 0) print "active";
      else print "idle/down";
    }')

    if [ "$inferred_status" = "active" ]; then
      echo "$ifname;$ifindex;$inferred_status;$rx_mbps;$tx_mbps;status_inferido_por_contador"
    else
      echo "$ifname;$ifindex;$inferred_status;0.00;0.00;sem_trafego_no_intervalo"
    fi

  done < <(discover_uplinks)
}

case "$MODE" in
  all)
    echo "### RESUMO OLT"
    collect_summary
    echo
    echo "### PROCESSADOR"
    collect_processor_table
    echo
    echo "### TEMPERATURAS"
    collect_temperatures
    echo
    echo "### UPLINKS"
    collect_uplinks
    ;;
  summary)
    collect_summary
    ;;
  processor)
    collect_processor_table
    ;;
  temperature)
    collect_temperatures
    ;;
  uplinks)
    collect_uplinks
    ;;
  *)
    echo "Modo inválido: $MODE"
    usage
    exit 1
    ;;
esac
