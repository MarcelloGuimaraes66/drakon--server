export type CameraDiscoveryProtocol =
  | "WS_DISCOVERY"
  | "ONVIF"
  | "HTTP_PROBE"
  | "RTSP_PROBE";

export interface DiscoveredCameraDevice {
  id: string;
  ip: string;
  friendly_name: string;
  manufacturer_guess: string;
  model_guess: string;
  discovery_protocols: CameraDiscoveryProtocol[];
  onvif_xaddrs: string[];
  rtsp_port_guess: number | null;
  channel_guess: string | null;
  subtype_guess: string | null;
  connection_method_suggested: "RTSP" | "HTTP" | "ONVIF";
  requires_credentials: boolean;
  confidence: number;
}

export interface CameraDiscoveryResponse {
  elapsed_ms: number;
  timeout_ms: number;
  devices: DiscoveredCameraDevice[];
}
