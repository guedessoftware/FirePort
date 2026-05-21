"use client"

import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet"
import { useEffect } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

delete ((L.Icon.Default.prototype as unknown) as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "/leaflet/images/marker-icon-2x.png",
  iconUrl: "/leaflet/images/marker-icon.png",
  shadowUrl: "/leaflet/images/marker-shadow.png",
})

const ctoIcon = L.icon({
  iconUrl: "/leaflet/color-markers/marker-icon-red.png",
  iconRetinaUrl: "/leaflet/color-markers/marker-icon-2x-red.png",
  shadowUrl: "/leaflet/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const provisioningIcon = L.icon({
  iconUrl: "/leaflet/color-markers/marker-icon-green.png",
  iconRetinaUrl: "/leaflet/color-markers/marker-icon-2x-green.png",
  shadowUrl: "/leaflet/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const offlineProvisioningIcon = L.icon({
  iconUrl: "/leaflet/color-markers/marker-icon-red.png",
  iconRetinaUrl: "/leaflet/color-markers/marker-icon-2x-red.png",
  shadowUrl: "/leaflet/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

type ProvisioningMapItem = {
  id: string
  serial: string
  onuStatus?: string | null
  onuRxPower?: number | null
  onuTxPower?: number | null
  contract: {
    name: string
    contractNumber: string
    address?: string
    lat: number
    lng: number
  }
  port: {
    number: number
    cto: {
      name: string
      lat?: number
      lng?: number
    }
  }
  cpeModel: { name: string }
}

type PopupIconName = "alert" | "contract" | "olt" | "serial" | "rx" | "tx" | "cto" | "port" | "refresh" | "history"

function SetMapCenter({ location }: { location: { lat: number; lng: number } }) {
  const map = useMap()

  useEffect(() => {
    map.setView([location.lat, location.lng], map.getZoom())
  }, [location, map])

  return null
}

function MapLocationClick({ onLocationChange }: { onLocationChange?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (event) => {
      onLocationChange?.(event.latlng.lat, event.latlng.lng)
    },
  })

  return null
}

function FitMapToProvisionings({ provisionings, fallback }: { provisionings: ProvisioningMapItem[]; fallback: { lat: number; lng: number } }) {
  const map = useMap()

  useEffect(() => {
    const points = provisionings
      .filter((item) => Number.isFinite(item.contract.lat) && Number.isFinite(item.contract.lng))
      .map((item) => [item.contract.lat, item.contract.lng] as [number, number])

    if (points.length === 0) {
      map.setView([fallback.lat, fallback.lng], map.getZoom())
      return
    }

    if (points.length === 1) {
      map.setView(points[0], 14)
      return
    }

    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 })
  }, [fallback, map, provisionings])

  return null
}

function formatPower(value?: number | null) {
  return typeof value === "number" ? `${value.toFixed(2)} dBm` : "sem leitura"
}

function normalizeOnuStatus(status?: string | null) {
  return status?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") ?? ""
}

function isUnavailableOnuStatus(status?: string | null) {
  const normalizedStatus = normalizeOnuStatus(status)

  return normalizedStatus === "dyinggasp"
    || normalizedStatus === "los"
    || normalizedStatus.includes("offline")
}

function displayOnuStatus(status?: string | null) {
  const normalizedStatus = normalizeOnuStatus(status)

  if (normalizedStatus === "dyinggasp") return "Desligado"
  if (normalizedStatus === "working") return "Online"
  return status || "Sem leitura"
}

function getProvisioningIcon(item: ProvisioningMapItem) {
  return isUnavailableOnuStatus(item.onuStatus) ? offlineProvisioningIcon : provisioningIcon
}

function PopupIcon({ name, className = "" }: { name: PopupIconName; className?: string }) {
  const commonProps = {
    className: `h-5 w-5 shrink-0 ${className}`,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  }

  if (name === "alert") return <svg {...commonProps}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 4.1 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" /></svg>
  if (name === "contract") return <svg {...commonProps}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  if (name === "olt") return <svg {...commonProps}><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" /></svg>
  if (name === "serial") return <svg {...commonProps}><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h3" /></svg>
  if (name === "rx") return <svg {...commonProps}><path d="M4.9 19.1a10 10 0 0 1 0-14.2" /><path d="M8.5 15.5a5 5 0 0 1 0-7" /><path d="M12 12h.01" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19.1 4.9a10 10 0 0 1 0 14.2" /></svg>
  if (name === "tx") return <svg {...commonProps}><path d="M5 12.5a7 7 0 0 1 14 0" /><path d="M8.5 15.5a4 4 0 0 1 7 0" /><path d="M12 19h.01" /><path d="M2 9a11 11 0 0 1 20 0" /></svg>
  if (name === "cto") return <svg {...commonProps}><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15" /><path d="M15 6v15" /></svg>
  if (name === "port") return <svg {...commonProps}><path d="M9 7V3" /><path d="M15 7V3" /><path d="M7 7h10v5a5 5 0 0 1-10 0V7Z" /><path d="M12 17v4" /></svg>
  if (name === "refresh") return <svg {...commonProps}><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 21v-5h5" /><path d="M3 12A9 9 0 0 1 18.4 5.6L21 8" /><path d="M16 8h5V3" /></svg>
  return <svg {...commonProps}><path d="M8 3h8l4 4v14H4V3h4Z" /><path d="M16 3v5h5" /><path d="M8 13h8" /><path d="M8 17h6" /></svg>
}

function PopupDetail({ icon, label, value, detail, tone = "default" }: { icon: PopupIconName; label: string; value: string; detail?: string; tone?: "default" | "danger" | "success" }) {
  const valueClass = tone === "danger" ? "text-red-700" : tone === "success" ? "text-emerald-700" : "text-slate-950"

  return (
    <div className="provisioning-popup-detail grid min-w-0 grid-cols-[20px_1fr] gap-2 sm:grid-cols-[28px_1fr] sm:gap-3">
      <PopupIcon name={icon} className="mt-0.5 h-4 w-4 text-slate-500 sm:mt-1 sm:h-5 sm:w-5" />
      <div className="min-w-0">
        <p className="provisioning-popup-detail-label truncate font-medium text-slate-500">{label}</p>
        <p className={`provisioning-popup-detail-value truncate font-bold leading-tight ${valueClass}`}>{value}</p>
        {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
      </div>
    </div>
  )
}

function ProvisioningPopup({ item, onViewCpe, onOpenLogs }: { item: ProvisioningMapItem; onViewCpe?: (item: ProvisioningMapItem) => void; onOpenLogs?: (item: ProvisioningMapItem) => void }) {
  const unavailable = isUnavailableOnuStatus(item.onuStatus)
  const status = displayOnuStatus(item.onuStatus)
  const rxPower = formatPower(item.onuRxPower)
  const txPower = formatPower(item.onuTxPower)

  return (
    <div className="provisioning-popup-card bg-white text-slate-950">
      <div className="provisioning-popup-header border-b border-slate-200 pr-11 sm:pr-14">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <h3 className="provisioning-popup-title max-w-full truncate font-black tracking-normal text-slate-950">{item.contract.name}</h3>
          <span className={unavailable ? "provisioning-popup-chip inline-flex items-center gap-1 rounded-[8px] bg-orange-100 font-black uppercase text-orange-700" : "provisioning-popup-chip inline-flex items-center gap-1 rounded-[8px] bg-emerald-100 font-black uppercase text-emerald-700"}>
            <PopupIcon name="alert" className="h-4 w-4" />
            {unavailable ? "Alerta de rede" : "ONU online"}
          </span>
        </div>
        <p className="provisioning-popup-subtitle hidden text-slate-600 min-[420px]:block">Painel de detalhes do ponto de acesso</p>
      </div>

      <div className="provisioning-popup-details grid grid-cols-2">
        <PopupDetail icon="contract" label="Contrato" value={item.contract.contractNumber} />
        <PopupDetail icon="olt" label="Status ONU" value={status} tone={unavailable ? "danger" : normalizeOnuStatus(item.onuStatus) === "working" ? "success" : "default"} />
        <PopupDetail icon="rx" label="Potencia RX" value={rxPower} tone={typeof item.onuRxPower === "number" ? "default" : "danger"} />
        <PopupDetail icon="tx" label="Potencia TX" value={txPower} tone={typeof item.onuTxPower === "number" ? "default" : "danger"} />
        <PopupDetail icon="serial" label="Serial" value={item.serial} />
        <PopupDetail icon="olt" label="CPE" value={item.cpeModel.name} />
      </div>

      <div className="provisioning-popup-location grid grid-cols-[18px_1fr_18px_auto] items-center gap-2 rounded-[8px] bg-slate-100 text-slate-600 sm:flex sm:flex-wrap">
        <PopupIcon name="cto" className="text-slate-500" />
        <span className="min-w-0 truncate">CTO: <strong className="text-slate-950">{item.port.cto.name}</strong></span>
        <span className="hidden text-slate-300 sm:inline">|</span>
        <PopupIcon name="port" className="text-slate-500" />
        <span className="whitespace-nowrap">Porta: <strong className="text-slate-950">{item.port.number}</strong></span>
      </div>

      {(onViewCpe || onOpenLogs) ? (
        <div className="provisioning-popup-actions grid grid-cols-2 sm:flex sm:flex-wrap">
          {onViewCpe ? (
            <button type="button" onClick={() => onViewCpe(item)} className="provisioning-popup-action inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[8px] bg-blue-600 font-bold text-white shadow-sm transition hover:bg-blue-700 sm:gap-2">
              <PopupIcon name="serial" className="h-4 w-4" />
              <span className="truncate">Ver CPE</span>
            </button>
          ) : null}
          {onOpenLogs ? (
            <button type="button" onClick={() => onOpenLogs(item)} className="provisioning-popup-action inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[8px] bg-slate-600 font-bold text-white shadow-sm transition hover:bg-slate-700 sm:gap-2">
              <PopupIcon name="history" className="h-4 w-4" />
              <span className="truncate">Ver historico</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ProvisionMap({
  location,
  cto,
  nearbyCtos,
  radiusMeters,
  onLocationChange,
  provisionings = [],
  onViewCpe,
  onOpenLogs,
}: {
  location: { lat: number; lng: number }
  cto?: { lat: number; lng: number; name: string }
  nearbyCtos?: { id: string; name: string; lat: number; lng: number; distance: number }[]
  radiusMeters: number
  onLocationChange?: (lat: number, lng: number) => void
  provisionings?: ProvisioningMapItem[]
  onViewCpe?: (item: ProvisioningMapItem) => void
  onOpenLogs?: (item: ProvisioningMapItem) => void
}) {
  const center: [number, number] = [location.lat, location.lng]
  const ctoCenter = cto ? [cto.lat, cto.lng] as [number, number] : undefined
  const radius = radiusMeters
  const hasProvisionings = provisionings.length > 0

  return (
    <MapContainer
      center={center}
      zoom={13}
      className="h-full w-full rounded-3xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="/api/map-tiles/{z}/{x}/{y}.png"
      />
      {hasProvisionings ? (
        <>
          <FitMapToProvisionings provisionings={provisionings} fallback={location} />
          {provisionings.map((item) => (
            <Marker key={item.id} position={[item.contract.lat, item.contract.lng]} icon={getProvisioningIcon(item)}>
              <Popup className="provisioning-popup" maxWidth={560} minWidth={220} autoPanPadding={[24, 24]} keepInView>
                <ProvisioningPopup item={item} onViewCpe={onViewCpe} onOpenLogs={onOpenLogs} />
              </Popup>
            </Marker>
          ))}
        </>
      ) : (
        <>
          <SetMapCenter location={location} />
          <MapLocationClick onLocationChange={onLocationChange} />
          <Circle center={center} radius={radius} pathOptions={{ color: "#2563eb", fillColor: "#bfdbfe", fillOpacity: 0.15 }} />
          <Marker
            position={center}
            draggable={!!onLocationChange}
            eventHandlers={onLocationChange ? {
              dragend: (e) => {
                const marker = e.target
                const position = marker.getLatLng()
                onLocationChange(position.lat, position.lng)
              }
            } : {}}
          >
            <Popup>
              {nearbyCtos && nearbyCtos.length > 0 ? (
                <div>
                  <p className="font-semibold">CTOs dentro de {radiusMeters}m:</p>
                  <ul className="list-disc pl-5">
                    {nearbyCtos.map((near) => (
                      <li key={near.id}>
                        {near.name} - {Math.round(near.distance * 1000)}m
                      </li>
                    ))}
                  </ul>
                </div>
              ) : onLocationChange ? (
                <span>Ponto do cliente</span>
              ) : (
                <span>Nenhum provisionamento ativo</span>
              )}
            </Popup>
          </Marker>
          {nearbyCtos?.map((near) => (
            <Marker key={near.id} position={[near.lat, near.lng]} icon={ctoIcon}>
              <Popup>{near.name} ({Math.round(near.distance * 1000)}m)</Popup>
            </Marker>
          ))}
          {ctoCenter ? (
            <Marker position={ctoCenter} icon={ctoIcon}>
              <Popup>{cto?.name} (CTO)</Popup>
            </Marker>
          ) : null}
        </>
      )}
    </MapContainer>
  )
}
