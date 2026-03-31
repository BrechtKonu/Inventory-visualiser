import { useState, useCallback, useRef, useMemo } from "react";

// ─── THEME: Industrial blueprint ────────────────────────────────────────────
const T = {
  bg: "#0a0e14",
  surface: "#111720",
  surfaceRaised: "#161d28",
  surfaceHover: "#1a2230",
  border: "#1e2a38",
  borderLight: "#283848",
  text: "#d4dae4",
  textSoft: "#8896a8",
  textDim: "#4a5a6e",
  accent: "#6e8efb",
  accentSoft: "rgba(110,142,251,0.12)",
  green: "#34d399",
  greenSoft: "rgba(52,211,153,0.12)",
  amber: "#f59e0b",
  amberSoft: "rgba(245,158,11,0.10)",
  rose: "#f43f5e",
  roseSoft: "rgba(244,63,94,0.10)",
  sky: "#38bdf8",
  violet: "#a78bfa",
  violetSoft: "rgba(167,139,250,0.10)",
};

const ROUTE_COLORS = [
  { stroke: "#6e8efb", fill: "rgba(110,142,251,0.06)" },
  { stroke: "#34d399", fill: "rgba(52,211,153,0.06)" },
  { stroke: "#f59e0b", fill: "rgba(245,158,11,0.06)" },
  { stroke: "#f472b6", fill: "rgba(244,114,182,0.06)" },
  { stroke: "#38bdf8", fill: "rgba(56,189,248,0.06)" },
  { stroke: "#a78bfa", fill: "rgba(167,139,250,0.06)" },
  { stroke: "#2dd4bf", fill: "rgba(45,212,191,0.06)" },
  { stroke: "#a3e635", fill: "rgba(163,230,53,0.06)" },
];

const nodeStyles = {
  warehouse: { color: T.accent, bg: T.accentSoft, icon: "⌂" },
  location: { color: T.green, bg: T.greenSoft, icon: "◎" },
  operation_type: { color: T.amber, bg: T.amberSoft, icon: "⛁" },
  route: { color: T.sky, bg: "rgba(56,189,248,0.10)", icon: "⚡" },
  putaway_rule: { color: T.violet, bg: T.violetSoft, icon: "⇲" },
};

// ─── FIELD DEFINITIONS ──────────────────────────────────────────────────────
const fieldDefs = {
  warehouse: [
    { key: "code", label: "Short Code", type: "text" },
    { key: "name", label: "Warehouse Name", type: "text" },
    { key: "reception_steps", label: "Reception Steps", type: "select", options: [
      { value: "one_step", label: "Receive directly (1 step)" },
      { value: "two_steps", label: "Input → Stock (2 steps)" },
      { value: "three_steps", label: "Input → QC → Stock (3 steps)" },
    ]},
    { key: "delivery_steps", label: "Delivery Steps", type: "select", options: [
      { value: "ship_only", label: "Deliver directly (1 step)" },
      { value: "pick_ship", label: "Pick → Ship (2 steps)" },
      { value: "pick_pack_ship", label: "Pick → Pack → Ship (3 steps)" },
    ]},
    { key: "buy_to_resupply", label: "Buy to Resupply", type: "boolean" },
    { key: "manufacture_to_resupply", label: "Manufacture to Resupply", type: "boolean" },
  ],
  location: [
    { key: "complete_name", label: "Full Name", type: "text" },
    { key: "usage", label: "Location Type", type: "select", options: [
      { value: "supplier", label: "Vendor" }, { value: "internal", label: "Internal" },
      { value: "customer", label: "Customer" }, { value: "inventory", label: "Inventory Loss" },
      { value: "production", label: "Production" }, { value: "transit", label: "Transit" },
    ]},
    { key: "scrap_location", label: "Scrap Location", type: "boolean" },
    { key: "return_location", label: "Return Location", type: "boolean" },
    { key: "replenish_location", label: "Replenish Location", type: "boolean" },
    { key: "removal_strategy", label: "Removal Strategy", type: "select", options: [
      { value: "fifo", label: "FIFO" }, { value: "lifo", label: "LIFO" },
      { value: "closest", label: "Closest" }, { value: "least_packages", label: "Least Packages" },
      { value: "fefo", label: "FEFO" },
    ]},
    { key: "barcode", label: "Barcode", type: "text" },
  ],
  operation_type: [
    { key: "name", label: "Operation Name", type: "text" },
    { key: "code", label: "Type", type: "select", options: [
      { value: "incoming", label: "Receipt" }, { value: "outgoing", label: "Delivery" },
      { value: "internal", label: "Internal Transfer" },
    ]},
    { key: "sequence_code", label: "Sequence Prefix", type: "text" },
    { key: "create_backorder", label: "Backorder", type: "select", options: [
      { value: "ask", label: "Ask" }, { value: "always", label: "Always" }, { value: "never", label: "Never" },
    ]},
    { key: "reservation_method", label: "Reservation", type: "select", options: [
      { value: "at_confirm", label: "At Confirmation" }, { value: "manual", label: "Manual" },
      { value: "by_date", label: "Before scheduled date" },
    ]},
    { key: "use_create_lots", label: "Create New Lots", type: "boolean" },
    { key: "use_existing_lots", label: "Use Existing Lots", type: "boolean" },
    { key: "show_reserved", label: "Show Reserved", type: "boolean" },
  ],
  route: [
    { key: "name", label: "Route Name", type: "text" },
    { key: "active", label: "Active", type: "boolean" },
    { key: "product_selectable", label: "Applicable on Product", type: "boolean" },
    { key: "product_categ_selectable", label: "Applicable on Category", type: "boolean" },
    { key: "warehouse_selectable", label: "Applicable on Warehouse", type: "boolean" },
    { key: "sale_selectable", label: "Applicable on SO", type: "boolean" },
    { key: "purchase_selectable", label: "Applicable on PO", type: "boolean" },
  ],
  rule: [
    { key: "name", label: "Description", type: "text" },
    { key: "action", label: "Action", type: "select", options: [
      { value: "pull", label: "Pull From" }, { value: "push", label: "Push To" },
      { value: "pull_push", label: "Pull & Push" }, { value: "buy", label: "Buy" },
      { value: "manufacture", label: "Manufacture" },
    ]},
    { key: "procure_method", label: "Supply Method", type: "select", options: [
      { value: "make_to_stock", label: "Take from Stock" },
      { value: "make_to_order", label: "Trigger another rule" },
      { value: "mts_else_mto", label: "Stock, else trigger rule" },
    ]},
    { key: "auto", label: "Automatic Move", type: "select", options: [
      { value: "manual", label: "Manual" }, { value: "transparent", label: "Automatic" },
    ]},
    { key: "propagate_cancel", label: "Propagate Cancel", type: "boolean" },
    { key: "delay", label: "Delay (days)", type: "number" },
  ],
  putaway_rule: [
    { key: "product_id", label: "Product", type: "text" },
    { key: "category_id", label: "Product Category", type: "text" },
    { key: "location_in_id", label: "When arriving in", type: "text" },
    { key: "location_out_id", label: "Store to sublocation", type: "text" },
    { key: "sequence", label: "Priority", type: "number" },
  ],
};

// ─── SVG ICON HELPER ────────────────────────────────────────────────────────
const ICONS = {
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  settings: "M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.04 7.04 0 00-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84a.48.48 0 00-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87a.48.48 0 00.12.61l2.03 1.58c-.04.31-.06.63-.06.94 0 .31.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.61 3.61 0 0112 15.6z",
  api: "M13 9h-2V7h2v2zm0 2h-2v6h2v-6zm-1-7C6.48 4 2 8.48 2 14s4.48 10 10 10 10-4.48 10-10S17.52 4 12 4zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
  copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
  download: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  upload: "M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z",
  fit: "M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3v6zm6 12l-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6h6zm12-6l-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6v-6z",
  eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
  eyeOff: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
};

const SI = ({ d, size = 16, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ flexShrink: 0 }}><path d={d} /></svg>
);

const Btn = ({ children, onClick, variant = "default", small, icon, disabled, title, style = {} }) => {
  const v = {
    default: { background: T.surfaceRaised, color: T.text, border: `1px solid ${T.border}` },
    primary: { background: T.accent, color: "#fff", border: "none" },
    danger: { background: T.roseSoft, color: T.rose, border: `1px solid ${T.rose}33` },
    ghost: { background: "transparent", color: T.textSoft, border: "none" },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      padding: small ? "5px 8px" : "7px 13px", borderRadius: 5, fontSize: small ? 11 : 12,
      fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer", display: "inline-flex",
      alignItems: "center", gap: 5, opacity: disabled ? 0.4 : 1,
      fontFamily: "'IBM Plex Sans', sans-serif", transition: "background 0.15s",
      ...v[variant], ...style,
    }}>
      {icon && <SI d={ICONS[icon]} size={small ? 13 : 15} />}{children}
    </button>
  );
};

const Badge = ({ children, color = T.accent }) => (
  <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color, background: `${color}1a` }}>{children}</span>
);

// ─── GEOMETRY HELPERS ───────────────────────────────────────────────────────
const NW = 160, NH = 48;
function nodeCenter(n) { return { x: n.x + NW / 2, y: n.y + NH / 2 }; }
function nodePort(n, side) {
  switch (side) {
    case "r": return { x: n.x + NW, y: n.y + NH / 2 };
    case "l": return { x: n.x, y: n.y + NH / 2 };
    case "t": return { x: n.x + NW / 2, y: n.y };
    case "b": return { x: n.x + NW / 2, y: n.y + NH };
    default: return nodeCenter(n);
  }
}
function bestPorts(s, d) {
  const sc = nodeCenter(s), dc = nodeCenter(d);
  const dx = dc.x - sc.x, dy = dc.y - sc.y;
  let ss, ds;
  if (Math.abs(dx) > Math.abs(dy)) { ss = dx > 0 ? "r" : "l"; ds = dx > 0 ? "l" : "r"; }
  else { ss = dy > 0 ? "b" : "t"; ds = dy > 0 ? "t" : "b"; }
  return { sp: nodePort(s, ss), dp: nodePort(d, ds), ss, ds };
}
function bPath(p1, p2, s1, s2, curveOffset = 0) {
  const dist = Math.max(40, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.35);
  const off = { r: { x: dist, y: 0 }, l: { x: -dist, y: 0 }, b: { x: 0, y: dist }, t: { x: 0, y: -dist } };
  const c1 = { x: p1.x + (off[s1]?.x || 0), y: p1.y + (off[s1]?.y || 0) };
  const c2 = { x: p2.x + (off[s2]?.x || 0), y: p2.y + (off[s2]?.y || 0) };
  
  // Apply lateral offset for bidirectional routes to prevent overlap
  if (curveOffset !== 0) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len; // perpendicular vector
    c1.x += nx * curveOffset;
    c1.y += ny * curveOffset;
    c2.x += nx * curveOffset;
    c2.y += ny * curveOffset;
  }
  
  return `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
}

// ─── SAMPLE DATA ────────────────────────────────────────────────────────────
const L = (id, label, x, y, usage, extra = {}) => ({ id, type: "location", label, x, y, data: { complete_name: label, usage, scrap_location: false, return_location: false, replenish_location: false, removal_strategy: "fifo", barcode: "", ...extra }});
const initData = () => ({
  nodes: [
    { id: "wh1", type: "warehouse", label: "Main Warehouse", x: 40, y: 10, data: { code: "WH", name: "Main Warehouse", reception_steps: "three_steps", delivery_steps: "pick_pack_ship", buy_to_resupply: true, manufacture_to_resupply: true }},
    // ── Partner locations
    L("loc-vendors", "Vendors", 40, 160, "supplier"),
    L("loc-customers", "Customers", 40, 700, "customer"),
    // ── Inbound
    L("loc-input", "WH/Input", 340, 130, "internal", { barcode: "WH-INPUT" }),
    L("loc-qc", "WH/Quality Control", 580, 130, "internal", { barcode: "WH-QC" }),
    // ── Storage
    L("loc-stock", "WH/Stock", 770, 320, "internal", { barcode: "WH-STOCK" }),
    // ── Outbound
    L("loc-output", "WH/Output", 340, 600, "internal", { barcode: "WH-OUTPUT" }),
    L("loc-packing", "WH/Packing", 340, 480, "internal", { barcode: "WH-PACK" }),
    // ── Production
    L("loc-preprod", "WH/Pre-Production", 980, 160, "internal", { barcode: "WH-PREPROD" }),
    L("loc-production", "Virtual/Production", 1160, 320, "production"),
    // ── Crossdock
    L("loc-crossdock", "WH/CrossDock", 580, 380, "internal", { barcode: "WH-XDOCK" }),
  ],
  operationTypes: [
    // Inbound
    { id: "op-receipt", label: "Receipts", code: "incoming", sequence_code: "IN", src_location_id: "loc-vendors", dest_location_id: "loc-input", data: { name: "Receipts", code: "incoming", sequence_code: "IN", create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: true, use_existing_lots: false, show_reserved: true }},
    { id: "op-qc", label: "Quality Check", code: "internal", sequence_code: "QC", src_location_id: "loc-input", dest_location_id: "loc-qc", data: { name: "Quality Check", code: "internal", sequence_code: "QC", create_backorder: "never", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true }},
    { id: "op-store", label: "Store", code: "internal", sequence_code: "STO", src_location_id: "loc-qc", dest_location_id: "loc-stock", data: { name: "Store (QC → Stock)", code: "internal", sequence_code: "STO", create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true }},
    // Outbound
    { id: "op-pick", label: "Pick", code: "internal", sequence_code: "PICK", src_location_id: "loc-stock", dest_location_id: "loc-packing", data: { name: "Pick", code: "internal", sequence_code: "PICK", create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true }},
    { id: "op-pack", label: "Pack", code: "internal", sequence_code: "PACK", src_location_id: "loc-packing", dest_location_id: "loc-output", data: { name: "Pack", code: "internal", sequence_code: "PACK", create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true }},
    { id: "op-delivery", label: "Delivery Orders", code: "outgoing", sequence_code: "OUT", src_location_id: "loc-output", dest_location_id: "loc-customers", data: { name: "Delivery Orders", code: "outgoing", sequence_code: "OUT", create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true }},
    // Production
    { id: "op-mo-pick", label: "MO Picking", code: "internal", sequence_code: "PC", src_location_id: "loc-stock", dest_location_id: "loc-preprod", data: { name: "MO Picking (Stock → Pre-Prod)", code: "internal", sequence_code: "PC", create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true }},
    { id: "op-mo-prod", label: "Manufacturing", code: "internal", sequence_code: "MO", src_location_id: "loc-preprod", dest_location_id: "loc-production", data: { name: "Manufacturing", code: "internal", sequence_code: "MO", create_backorder: "never", reservation_method: "at_confirm", use_create_lots: true, use_existing_lots: false, show_reserved: false }},
    { id: "op-mo-store", label: "Post-Production", code: "internal", sequence_code: "SFP", src_location_id: "loc-production", dest_location_id: "loc-stock", data: { name: "Store Finished Products", code: "internal", sequence_code: "SFP", create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true }},
    // Crossdock
    { id: "op-crossdock", label: "CrossDock", code: "internal", sequence_code: "XD", src_location_id: "loc-input", dest_location_id: "loc-crossdock", data: { name: "CrossDock Transfer", code: "internal", sequence_code: "XD", create_backorder: "never", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true }},
    { id: "op-xd-out", label: "XD Ship", code: "outgoing", sequence_code: "XDS", src_location_id: "loc-crossdock", dest_location_id: "loc-customers", data: { name: "CrossDock Ship", code: "outgoing", sequence_code: "XDS", create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true }},
  ],
  routes: [
    // ── Receive in 3 steps (Input → QC → Stock)
    { id: "route-recv3", label: "Receive 3 steps (Input→QC→Stock)", colorIdx: 0,
      data: { name: "WH: Receive in 3 steps", active: true, product_selectable: false, product_categ_selectable: false, warehouse_selectable: true, sale_selectable: false, purchase_selectable: false },
      rules: [
        { id: "rl-r3a", label: "Vendors → Input", action: "pull", procure_method: "make_to_order", src_location_id: "loc-vendors", dest_location_id: "loc-input", picking_type_id: "op-receipt", auto: "manual", data: { name: "Vendors → Input", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: false, delay: 0 }},
        { id: "rl-r3b", label: "Input → QC", action: "pull", procure_method: "make_to_order", src_location_id: "loc-input", dest_location_id: "loc-qc", picking_type_id: "op-qc", auto: "manual", data: { name: "Input → QC", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: false, delay: 0 }},
        { id: "rl-r3c", label: "QC → Stock", action: "pull", procure_method: "make_to_stock", src_location_id: "loc-qc", dest_location_id: "loc-stock", picking_type_id: "op-store", auto: "manual", data: { name: "QC → Stock", action: "pull", procure_method: "make_to_stock", auto: "manual", propagate_cancel: false, delay: 0 }},
      ]},
    // ── Pick-Pack-Ship (web orders)
    { id: "route-pps", label: "Pick → Pack → Ship (Web)", colorIdx: 1,
      data: { name: "WH: Pick Pack Ship", active: true, product_selectable: false, product_categ_selectable: false, warehouse_selectable: true, sale_selectable: true, purchase_selectable: false },
      rules: [
        { id: "rl-pps1", label: "Stock → Packing", action: "pull", procure_method: "make_to_order", src_location_id: "loc-stock", dest_location_id: "loc-packing", picking_type_id: "op-pick", auto: "manual", data: { name: "Stock → Packing", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: true, delay: 0 }},
        { id: "rl-pps2", label: "Packing → Output", action: "pull", procure_method: "make_to_order", src_location_id: "loc-packing", dest_location_id: "loc-output", picking_type_id: "op-pack", auto: "manual", data: { name: "Packing → Output", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: true, delay: 0 }},
        { id: "rl-pps3", label: "Output → Customers", action: "pull", procure_method: "make_to_order", src_location_id: "loc-output", dest_location_id: "loc-customers", picking_type_id: "op-delivery", auto: "manual", data: { name: "Output → Customers", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: true, delay: 0 }},
      ]},
    // ── Production (with picking step)
    { id: "route-prod", label: "Manufacture (with picking)", colorIdx: 2,
      data: { name: "WH: Manufacture", active: true, product_selectable: true, product_categ_selectable: true, warehouse_selectable: false, sale_selectable: false, purchase_selectable: false },
      rules: [
        { id: "rl-mo1", label: "Stock → Pre-Prod", action: "pull", procure_method: "make_to_order", src_location_id: "loc-stock", dest_location_id: "loc-preprod", picking_type_id: "op-mo-pick", auto: "manual", data: { name: "Stock → Pre-Production", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: false, delay: 0 }},
        { id: "rl-mo2", label: "Pre-Prod → Production", action: "manufacture", procure_method: "make_to_order", src_location_id: "loc-preprod", dest_location_id: "loc-production", picking_type_id: "op-mo-prod", auto: "manual", data: { name: "Manufacturing Order", action: "manufacture", procure_method: "make_to_order", auto: "manual", propagate_cancel: false, delay: 1 }},
        { id: "rl-mo3", label: "Production → Stock", action: "push", procure_method: "make_to_stock", src_location_id: "loc-production", dest_location_id: "loc-stock", picking_type_id: "op-mo-store", auto: "transparent", data: { name: "Post-Production → Stock", action: "push", procure_method: "make_to_stock", auto: "transparent", propagate_cancel: false, delay: 0 }},
      ]},
    // ── Crossdock
    { id: "route-xdock", label: "CrossDock", colorIdx: 3,
      data: { name: "WH: CrossDock", active: true, product_selectable: true, product_categ_selectable: false, warehouse_selectable: false, sale_selectable: true, purchase_selectable: false },
      rules: [
        { id: "rl-xd1", label: "Input → CrossDock", action: "pull", procure_method: "make_to_order", src_location_id: "loc-input", dest_location_id: "loc-crossdock", picking_type_id: "op-crossdock", auto: "transparent", data: { name: "Input → CrossDock", action: "pull", procure_method: "make_to_order", auto: "transparent", propagate_cancel: true, delay: 0 }},
        { id: "rl-xd2", label: "CrossDock → Customers", action: "pull", procure_method: "make_to_order", src_location_id: "loc-crossdock", dest_location_id: "loc-customers", picking_type_id: "op-xd-out", auto: "manual", data: { name: "CrossDock → Customers", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: true, delay: 0 }},
      ]},
    // ── Buy (simple replenishment)
    { id: "route-buy", label: "Buy", colorIdx: 4,
      data: { name: "WH: Buy", active: true, product_selectable: false, product_categ_selectable: false, warehouse_selectable: true, sale_selectable: false, purchase_selectable: false },
      rules: [
        { id: "rl-buy1", label: "Buy → Input", action: "buy", procure_method: "make_to_order", src_location_id: "loc-vendors", dest_location_id: "loc-input", picking_type_id: "op-receipt", auto: "manual", data: { name: "Buy", action: "buy", procure_method: "make_to_order", auto: "manual", propagate_cancel: false, delay: 3 }},
      ]},
  ],
  // ── Putaway rules (separate from canvas nodes) ── 
  putawayRules: [
    // WH/Stock — shelf assignments
    { id: "pa-1", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf A/Bin 1", product: "FURN_7800 Office Desk", category: "", sequence: 1 },
    { id: "pa-2", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf A/Bin 2", product: "FURN_7801 Standing Desk", category: "", sequence: 2 },
    { id: "pa-3", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf A/Bin 3", product: "FURN_8999 Ergonomic Chair", category: "", sequence: 3 },
    { id: "pa-4", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf B", product: "", category: "Electronics", sequence: 5 },
    { id: "pa-5", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf B/Bin 1", product: "ELEC_001 Laptop 15\"", category: "", sequence: 4 },
    { id: "pa-6", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf B/Bin 2", product: "ELEC_002 Monitor 27\"", category: "", sequence: 4 },
    { id: "pa-7", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf C", product: "", category: "Office Supplies", sequence: 6 },
    { id: "pa-8", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf D", product: "", category: "Packaging Materials", sequence: 7 },
    { id: "pa-9", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf E/Pallet", product: "", category: "Raw Materials", sequence: 8 },
    { id: "pa-10", location_in_id: "loc-stock", location_out: "WH/Stock/Hazardous", product: "", category: "Chemicals", sequence: 9 },
    { id: "pa-11", location_in_id: "loc-stock", location_out: "WH/Stock/Cold Room", product: "", category: "Perishable", sequence: 10 },
    { id: "pa-12", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf F/Oversize", product: "", category: "Furniture/Large", sequence: 11 },
    { id: "pa-13", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf G", product: "", category: "Spare Parts", sequence: 12 },
    { id: "pa-14", location_in_id: "loc-stock", location_out: "WH/Stock/Shelf A", product: "", category: "All", sequence: 99 },
    // WH/QC
    { id: "pa-15", location_in_id: "loc-qc", location_out: "WH/QC/Pending", product: "", category: "All", sequence: 10 },
    // WH/Pre-Production
    { id: "pa-16", location_in_id: "loc-preprod", location_out: "WH/Pre-Prod/Line 1", product: "", category: "Assemblies", sequence: 5 },
    { id: "pa-17", location_in_id: "loc-preprod", location_out: "WH/Pre-Prod/Line 2", product: "", category: "Components", sequence: 6 },
  ],
});

// ─── ROUTE OFFSET DETECTION (prevent bidirectional arrow overlap) ──────────
function buildBidirectionalMap(routes) {
  // Map rule pairs like "A→B" and "B→A" to apply curve offsets
  const map = new Map(); // key: "A→B", value: { forward: ruleId, reverse: ruleId }
  
  routes.forEach(route => {
    route.rules.forEach(rule => {
      const key = `${rule.src_location_id}→${rule.dest_location_id}`;
      const revKey = `${rule.dest_location_id}→${rule.src_location_id}`;
      
      if (map.has(revKey)) {
        const existing = map.get(revKey);
        existing.reverse = rule.id;
        map.set(key, { forward: rule.id, reverse: null });
      } else if (!map.has(key)) {
        map.set(key, { forward: rule.id, reverse: null });
      }
    });
  });
  
  return map;
}

function getCurveOffset(ruleId, routes, bidirMap, isBidirectional = false) {
  // Returns +offset for one direction, -offset for reverse direction
  if (!isBidirectional) return 0;
  
  for (const [_, pair] of bidirMap) {
    if (pair.forward === ruleId) return -30;
    if (pair.reverse === ruleId) return 30;
  }
  return 0;
}

// ─── PUTAWAY RULES PANEL ────────────────────────────────────────────────────
const PutawayPanel = ({ locationId, locationLabel, rules, onUpdate, onAdd, onDelete, onClose }) => {
  const locRules = rules.filter(r => r.location_in_id === locationId).sort((a, b) => a.sequence - b.sequence);

  return (
    <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 400, background: T.surface, borderLeft: `1px solid ${T.border}`, display: "flex", flexDirection: "column", zIndex: 35, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 5, background: T.violetSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>⇲</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Putaway Rules</div>
            <div style={{ fontSize: 10, color: T.textSoft }}>{locationLabel}</div>
          </div>
        </div>
        <Btn variant="ghost" small icon="close" onClick={onClose} />
      </div>

      {/* Column headers */}
      <div style={{ display: "flex", padding: "8px 16px 4px", gap: 6, borderBottom: `1px solid ${T.border}` }}>
        <span style={{ width: 28, fontSize: 8, fontWeight: 700, color: T.textDim, textTransform: "uppercase" }}>Seq</span>
        <span style={{ flex: 1, fontSize: 8, fontWeight: 700, color: T.textDim, textTransform: "uppercase" }}>Product / Category</span>
        <span style={{ flex: 1, fontSize: 8, fontWeight: 700, color: T.textDim, textTransform: "uppercase" }}>Store to</span>
        <span style={{ width: 24 }}></span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {locRules.length === 0 && (
          <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 11, color: T.textDim }}>No putaway rules for this location yet.</div>
        )}
        {locRules.map(rule => (
          <div key={rule.id} style={{ display: "flex", alignItems: "center", padding: "6px 16px", gap: 6, borderBottom: `1px solid ${T.border}08` }}
            onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <input type="number" value={rule.sequence} onChange={e => onUpdate(rule.id, { sequence: parseInt(e.target.value) || 0 })}
              style={{ width: 28, padding: "3px 4px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 3, color: T.violet, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", outline: "none", textAlign: "center", boxSizing: "border-box" }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <input type="text" value={rule.product} placeholder="Product" onChange={e => onUpdate(rule.id, { product: e.target.value })}
                style={{ width: "100%", padding: "2px 6px", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 3, color: T.text, fontSize: 10, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
              <input type="text" value={rule.category} placeholder="Category" onChange={e => onUpdate(rule.id, { category: e.target.value })}
                style={{ width: "100%", padding: "2px 6px", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 3, color: T.textSoft, fontSize: 9, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            </div>
            <input type="text" value={rule.location_out} placeholder="Sublocation" onChange={e => onUpdate(rule.id, { location_out: e.target.value })}
              style={{ flex: 1, padding: "3px 6px", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 3, color: T.text, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }} />
            <button onClick={() => onDelete(rule.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", opacity: 0.4 }}
              onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.4}>
              <SI d={ICONS.delete} size={12} color={T.rose} />
            </button>
          </div>
        ))}
      </div>

      <div style={{ padding: "8px 16px", borderTop: `1px solid ${T.border}` }}>
        <button onClick={() => onAdd(locationId)} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "7px 8px", background: "transparent", border: `1px dashed ${T.border}`, borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}
          onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; e.currentTarget.style.borderColor = T.violet + "44"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = T.border; }}>
          <SI d={ICONS.add} size={11} color={T.violet} />
          <span style={{ fontSize: 9, fontWeight: 600, color: T.violet }}>Add Putaway Rule</span>
        </button>
      </div>
    </div>
  );
};

// ─── PROPERTY PANEL ─────────────────────────────────────────────────────────
const PropPanel = ({ sel, data, onUpdate, onClose, onDelete }) => {
  if (!sel) return null;
  const { type, id, item } = sel;
  const fields = fieldDefs[type] || [];
  const s = nodeStyles[type] || nodeStyles.location;

  return (
    <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 330, background: T.surface, borderLeft: `1px solid ${T.border}`, display: "flex", flexDirection: "column", zIndex: 30, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 5, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{s.icon}</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{item?.label || item?.name || id}</div>
            <Badge color={s.color}>{type.replace(/_/g, " ")}</Badge>
          </div>
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          <Btn variant="danger" small icon="delete" onClick={() => onDelete(type, id)} />
          <Btn variant="ghost" small icon="close" onClick={onClose} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {type !== "rule" && item?.label !== undefined && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Label</label>
            <input type="text" value={item.label} onChange={e => onUpdate(type, id, { label: e.target.value })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
          </div>
        )}
        {type === "operation_type" && (
          <>
            <div style={{ fontSize: 9, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${T.border}` }}>Location Mapping</div>
            {["src_location_id", "dest_location_id"].map(k => (
              <div key={k} style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>{k === "src_location_id" ? "Source Location" : "Dest Location"}</label>
                <select value={item[k] || ""} onChange={e => onUpdate(type, id, { [k]: e.target.value })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }}>
                  {data.nodes.filter(n => n.type === "location").map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                </select>
              </div>
            ))}
          </>
        )}
        {type === "rule" && (
          <>
            <div style={{ fontSize: 9, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${T.border}` }}>Connections</div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Label</label>
              <input type="text" value={item.label} onChange={e => onUpdate(type, id, { label: e.target.value })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            </div>
            {["src_location_id", "dest_location_id"].map(k => (
              <div key={k} style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>{k.includes("src") ? "Source" : "Destination"}</label>
                <select value={item[k]} onChange={e => onUpdate(type, id, { [k]: e.target.value })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }}>
                  {data.nodes.filter(n => n.type === "location").map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                </select>
              </div>
            ))}
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Operation Type</label>
              <select value={item.picking_type_id} onChange={e => onUpdate(type, id, { picking_type_id: e.target.value })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }}>
                {data.operationTypes.map(op => <option key={op.id} value={op.id}>{op.label}</option>)}
              </select>
            </div>
          </>
        )}
        <div style={{ fontSize: 9, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${T.border}`, marginTop: 4 }}>Odoo Fields</div>
        {fields.map(f => (
          <div key={f.key} style={{ marginBottom: 10 }}>
            <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 3 }}>{f.label}</label>
            {f.type === "boolean" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={!!item.data?.[f.key]} onChange={e => onUpdate(type, id, { data: { ...item.data, [f.key]: e.target.checked } })} style={{ accentColor: T.accent, width: 13, height: 13 }} />
                <span style={{ fontSize: 11, color: T.text }}>{item.data?.[f.key] ? "Yes" : "No"}</span>
              </label>
            ) : f.type === "select" ? (
              <select value={item.data?.[f.key] || ""} onChange={e => onUpdate(type, id, { data: { ...item.data, [f.key]: e.target.value } })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}>
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input type={f.type === "number" ? "number" : "text"} value={item.data?.[f.key] ?? ""} onChange={e => onUpdate(type, id, { data: { ...item.data, [f.key]: f.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value } })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 12, fontFamily: f.type === "number" ? "'IBM Plex Mono', monospace" : "inherit", outline: "none", boxSizing: "border-box" }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── API PANEL ──────────────────────────────────────────────────────────────
const ApiPanel = ({ data, apiConfig, onClose }) => {
  const [tab, setTab] = useState("fetch");
  const u = apiConfig.url || "https://your-odoo.com", db = apiConfig.db || "your_db", l = apiConfig.username || "admin";
  const fetchCode = `import xmlrpc.client\n\nurl = "${u}"\ndb = "${db}"\nusername = "${l}"\napi_key = "YOUR_API_KEY"  # Settings → Users → API Keys\n\ncommon = xmlrpc.client.ServerProxy(f"{u}/xmlrpc/2/common")\nuid = common.authenticate(db, username, api_key, {})\nmodels = xmlrpc.client.ServerProxy(f"{u}/xmlrpc/2/object")\n\ndef sr(model, domain=[], fields=[], limit=100):\n    return models.execute_kw(db, uid, api_key, model, 'search_read', [domain], {'fields': fields, 'limit': limit})\n\nwarehouses = sr('stock.warehouse', [], ['name','code','reception_steps','delivery_steps'])\nlocations = sr('stock.location', [('usage','!=','view')], ['complete_name','usage','removal_strategy','barcode'])\npicking_types = sr('stock.picking.type', [], ['name','code','sequence_code','default_location_src_id','default_location_dest_id','create_backorder','reservation_method'])\nroutes = sr('stock.route', [], ['name','active','rule_ids','product_selectable','warehouse_selectable','sale_selectable','purchase_selectable'])\n\nfor route in routes:\n    if route.get('rule_ids'):\n        rules = sr('stock.rule', [('id','in',route['rule_ids'])], ['name','action','procure_method','location_src_id','location_dest_id','picking_type_id','auto','delay'])\n        for r in rules:\n            src = r.get('location_src_id',[0,''])[1] if isinstance(r.get('location_src_id'),(list,tuple)) else ''\n            dst = r.get('location_dest_id',[0,''])[1] if isinstance(r.get('location_dest_id'),(list,tuple)) else ''\n            print(f"  [{r['action']}] {src} → {dst}")\n\nputaway = sr('stock.putaway.rule', [], ['product_id','category_id','location_in_id','location_out_id','sequence'])\nprint(f"\\nTotal: {len(warehouses)} WH, {len(locations)} loc, {len(picking_types)} ops, {len(routes)} routes, {len(putaway)} putaway")`;
  const writeCode = `import xmlrpc.client\n\nurl = "${u}"\ndb = "${db}"\nusername = "${l}"\napi_key = "YOUR_API_KEY"\n\ncommon = xmlrpc.client.ServerProxy(f"{u}/xmlrpc/2/common")\nuid = common.authenticate(db, username, api_key, {})\nmodels = xmlrpc.client.ServerProxy(f"{u}/xmlrpc/2/object")\n\ndef write(model, rid, vals):\n    return models.execute_kw(db, uid, api_key, model, 'write', [[rid], vals])\n\ndef create(model, vals):\n    return models.execute_kw(db, uid, api_key, model, 'create', [vals])\n\n# ── Operation Types ──\n${data.operationTypes.map(op => `# ${op.label}: write('stock.picking.type', ID, ${JSON.stringify(op.data)})`).join("\n")}\n\n# ── Routes & Rules ──\n${data.routes.map(r => `# Route: ${r.label}\n# route_id = create('stock.route', ${JSON.stringify(r.data)})\n${r.rules.map(rl => `# create('stock.rule', {**${JSON.stringify(rl.data)}, 'route_id': route_id})`).join("\n")}`).join("\n\n")}`;
  const code = tab === "fetch" ? fetchCode : writeCode;

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
      <div style={{ width: 680, maxHeight: "85vh", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Odoo API — Python xmlrpc</span>
          <Btn variant="ghost" small icon="close" onClick={onClose} />
        </div>
        <div style={{ display: "flex", borderBottom: `1px solid ${T.border}` }}>
          {[{ k: "fetch", l: "Fetch", i: "download" }, { k: "write", l: "Write", i: "upload" }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{ flex: 1, padding: 8, background: tab === t.k ? T.surfaceRaised : "transparent", border: "none", borderBottom: tab === t.k ? `2px solid ${T.accent}` : "2px solid transparent", color: tab === t.k ? T.text : T.textSoft, fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontFamily: "inherit" }}>
              <SI d={ICONS[t.i]} size={12} />{t.l}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <button onClick={() => navigator.clipboard?.writeText(code)} style={{ position: "absolute", top: 8, right: 12, padding: "4px 8px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 4, color: T.textSoft, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontFamily: "inherit", zIndex: 2 }}><SI d={ICONS.copy} size={10} />Copy</button>
          <pre style={{ margin: 0, padding: "16px 18px", fontSize: 10.5, lineHeight: 1.55, color: T.text, fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{code}</pre>
        </div>
      </div>
    </div>
  );
};

// ─── CONFIG MODAL ───────────────────────────────────────────────────────────
const CfgModal = ({ cfg, onChange, onClose }) => (
  <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
    <div style={{ width: 400, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Odoo Connection</span>
        <Btn variant="ghost" small icon="close" onClick={onClose} />
      </div>
      <div style={{ padding: "14px 18px" }}>
        {[{ k: "url", l: "Server URL", p: "https://mycompany.odoo.com" }, { k: "db", l: "Database", p: "mycompany-main" }, { k: "username", l: "Login", p: "admin@company.com" }, { k: "apiKey", l: "API Key", p: "Settings → Users → API Keys", t: "password" }].map(f => (
          <div key={f.k} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 9, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>{f.l}</label>
            <input type={f.t || "text"} value={cfg[f.k] || ""} placeholder={f.p} onChange={e => onChange({ ...cfg, [f.k]: e.target.value })} style={{ width: "100%", padding: "7px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="api">Test</Btn></div>
      </div>
    </div>
  </div>
);

// ─── ADD MODAL ──────────────────────────────────────────────────────────────
const AddModal = ({ onAdd, routes, onAddRule, onClose }) => {
  const [ruleTarget, setRuleTarget] = useState(null);

  if (ruleTarget) {
    return (
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
        <div style={{ width: 360, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setRuleTarget(null)} style={{ background: "none", border: "none", cursor: "pointer", color: T.textSoft, fontSize: 14, fontFamily: "inherit", padding: 0 }}>←</button>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Add Rule to Route</span>
            </div>
            <Btn variant="ghost" small icon="close" onClick={onClose} />
          </div>
          <div style={{ padding: "8px 12px" }}>
            {routes.length === 0 ? (
              <div style={{ padding: "16px 10px", textAlign: "center", fontSize: 11, color: T.textDim }}>No routes yet. Create a route first.</div>
            ) : routes.map(r => {
              const rc = ROUTE_COLORS[r.colorIdx % ROUTE_COLORS.length];
              return (
                <button key={r.id} onClick={() => { onAddRule(r.id); onClose(); }}
                  style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "9px 10px", background: "transparent", border: "none", borderRadius: 5, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: rc.stroke, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{r.label}</div>
                    <div style={{ fontSize: 9, color: T.textDim }}>{r.rules.length} rule{r.rules.length !== 1 ? "s" : ""}</div>
                  </div>
                  <span style={{ fontSize: 9, color: rc.stroke, fontFamily: "'IBM Plex Mono', monospace" }}>+ rule</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
      <div style={{ width: 360, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Add to Flow</span>
          <Btn variant="ghost" small icon="close" onClick={onClose} />
        </div>
        <div style={{ padding: "6px 10px" }}>
          {[
            { t: "warehouse", l: "Warehouse", d: "Top-level warehouse config" },
            { t: "location", l: "Location", d: "Stock location node" },
            { t: "operation_type", l: "Operation Type", d: "Group container (src → dest)" },
          ].map(i => {
            const s = nodeStyles[i.t];
            return (
              <button key={i.t} onClick={() => onAdd(i.t)} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "9px 10px", background: "transparent", border: "none", borderRadius: 5, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ width: 30, height: 30, borderRadius: 5, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{s.icon}</div>
                <div><div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{i.l}</div><div style={{ fontSize: 9, color: T.textSoft }}>{i.d}</div></div>
              </button>
            );
          })}
          <div style={{ height: 1, background: T.border, margin: "6px 10px" }} />
          <div style={{ padding: "2px 10px 4px", fontSize: 8, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.6px" }}>Routes & Rules</div>
          <button onClick={() => onAdd("route")} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "9px 10px", background: "transparent", border: "none", borderRadius: 5, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
            onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ width: 30, height: 30, borderRadius: 5, background: nodeStyles.route.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>⚡</div>
            <div><div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>New Route</div><div style={{ fontSize: 9, color: T.textSoft }}>Empty route — add rules after</div></div>
          </button>
          <button onClick={() => setRuleTarget(true)} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "9px 10px", background: "transparent", border: "none", borderRadius: 5, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
            onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ width: 30, height: 30, borderRadius: 5, background: "rgba(56,189,248,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, color: T.sky, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700 }}>→</div>
            <div><div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>Add Rule to Route</div><div style={{ fontSize: 9, color: T.textSoft }}>Pick a route, then configure the rule</div></div>
          </button>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [data, setData] = useState(initData);
  const [scale, setScale] = useState(0.72);
  const [offset, setOffset] = useState({ x: 240, y: 30 });
  const [sel, setSel] = useState(null);
  const [isPan, setIsPan] = useState(false);
  const [panSt, setPanSt] = useState({ x: 0, y: 0 });
  const [dragId, setDragId] = useState(null);
  const [dragT, setDragT] = useState(null);
  const [dragOff, setDragOff] = useState({ x: 0, y: 0 });
  const [hidden, setHidden] = useState(new Set());
  const [showCfg, setShowCfg] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [apiCfg, setApiCfg] = useState({ url: "", db: "", username: "", apiKey: "" });
  const [putawayLoc, setPutawayLoc] = useState(null); // locationId to show putaway panel for
  const svgRef = useRef(null);

  // Putaway rule handlers
  const putawayUpdate = useCallback((ruleId, upd) => {
    setData(p => ({ ...p, putawayRules: p.putawayRules.map(r => r.id === ruleId ? { ...r, ...upd } : r) }));
  }, []);
  const putawayAdd = useCallback((locId) => {
    const ts = Date.now();
    setData(p => ({ ...p, putawayRules: [...p.putawayRules, { id: `pa-${ts}`, location_in_id: locId, location_out: "", product: "", category: "", sequence: 99 }] }));
  }, []);
  const putawayDelete = useCallback((ruleId) => {
    setData(p => ({ ...p, putawayRules: p.putawayRules.filter(r => r.id !== ruleId) }));
  }, []);

  const doSelect = useCallback((id) => {
    setPutawayLoc(null); // close putaway panel
    setData(d => {
      const n = d.nodes.find(x => x.id === id);
      if (n) { setSel({ type: n.type, id, item: n }); return d; }
      const op = d.operationTypes.find(x => x.id === id);
      if (op) { setSel({ type: "operation_type", id, item: op }); return d; }
      for (const r of d.routes) {
        if (r.id === id) { setSel({ type: "route", id, item: r }); return d; }
        const rl = r.rules.find(x => x.id === id);
        if (rl) { setSel({ type: "rule", id, item: rl }); return d; }
      }
      return d;
    });
  }, []);

  const doUpdate = useCallback((type, id, upd) => {
    setData(p => {
      const n = { ...p };
      if (["warehouse", "location", "putaway_rule"].includes(type)) {
        n.nodes = p.nodes.map(x => x.id === id ? { ...x, ...upd } : x);
        const u = n.nodes.find(x => x.id === id);
        if (u) setSel(s => s?.id === id ? { ...s, item: u } : s);
      } else if (type === "operation_type") {
        n.operationTypes = p.operationTypes.map(x => x.id === id ? { ...x, ...upd } : x);
        const u = n.operationTypes.find(x => x.id === id);
        if (u) setSel(s => s?.id === id ? { ...s, item: u } : s);
      } else if (type === "route") {
        n.routes = p.routes.map(x => x.id === id ? { ...x, ...upd } : x);
        const u = n.routes.find(x => x.id === id);
        if (u) setSel(s => s?.id === id ? { ...s, item: u } : s);
      } else if (type === "rule") {
        n.routes = p.routes.map(r => ({ ...r, rules: r.rules.map(x => x.id === id ? { ...x, ...upd } : x) }));
        for (const r of n.routes) { const u = r.rules.find(x => x.id === id); if (u) { setSel(s => s?.id === id ? { ...s, item: u } : s); break; } }
      }
      return n;
    });
  }, []);

  const doDelete = useCallback((type, id) => {
    setData(p => {
      const n = { ...p };
      if (["warehouse", "location", "putaway_rule"].includes(type)) n.nodes = p.nodes.filter(x => x.id !== id);
      else if (type === "operation_type") n.operationTypes = p.operationTypes.filter(x => x.id !== id);
      else if (type === "route") n.routes = p.routes.filter(x => x.id !== id);
      else if (type === "rule") n.routes = p.routes.map(r => ({ ...r, rules: r.rules.filter(x => x.id !== id) }));
      return n;
    });
    setSel(null);
  }, []);

  const doAdd = useCallback((type) => {
    const cx = (-offset.x + 500) / scale, cy = (-offset.y + 300) / scale, ts = Date.now();
    setData(p => {
      const n = { ...p };
      if (["location", "warehouse", "putaway_rule"].includes(type)) {
        const defs = {};
        (fieldDefs[type] || []).forEach(f => { defs[f.key] = f.type === "boolean" ? false : f.type === "number" ? 0 : f.type === "select" ? f.options[0]?.value || "" : ""; });
        n.nodes = [...p.nodes, { id: `${type.slice(0, 3)}-${ts}`, type, label: `New ${type.replace(/_/g, " ")}`, x: cx, y: cy, data: defs }];
      } else if (type === "operation_type") {
        const locs = p.nodes.filter(x => x.type === "location");
        n.operationTypes = [...p.operationTypes, { id: `op-${ts}`, label: "New Operation", code: "internal", sequence_code: "NEW", src_location_id: locs[0]?.id || "", dest_location_id: locs[1]?.id || locs[0]?.id || "", data: { name: "New Operation", code: "internal", sequence_code: "NEW", create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true } }];
      } else if (type === "route") {
        n.routes = [...p.routes, { id: `route-${ts}`, label: "New Route", colorIdx: p.routes.length % ROUTE_COLORS.length, data: { name: "New Route", active: true, product_selectable: false, product_categ_selectable: false, warehouse_selectable: true, sale_selectable: false, purchase_selectable: false }, rules: [] }];
      }
      return n;
    });
    setShowAdd(false);
  }, [offset, scale]);

  const addRuleToRoute = useCallback((routeId) => {
    const ts = Date.now();
    setData(p => {
      const locs = p.nodes.filter(x => x.type === "location");
      const newRule = {
        id: `rule-${ts}`, label: "New Rule", action: "pull", procure_method: "make_to_stock",
        src_location_id: locs[0]?.id || "", dest_location_id: locs[1]?.id || locs[0]?.id || "",
        picking_type_id: p.operationTypes[0]?.id || "", auto: "manual",
        data: { name: "New Rule", action: "pull", procure_method: "make_to_stock", auto: "manual", propagate_cancel: false, delay: 0 },
      };
      return {
        ...p,
        routes: p.routes.map(r => r.id === routeId ? { ...r, rules: [...r.rules, newRule] } : r),
      };
    });
    setTimeout(() => doSelect(`rule-${ts}`), 20);
  }, [doSelect]);

  // Pan/drag handlers
  const onCanvasDown = useCallback((e) => {
    if (e.target === svgRef.current || e.target.getAttribute("data-bg")) {
      setIsPan(true); setPanSt({ x: e.clientX - offset.x, y: e.clientY - offset.y }); setSel(null);
    }
  }, [offset]);

  const onDragStart = useCallback((id, e, type) => {
    setDragId(id); setDragT(type);
    if (type === "node") {
      const nd = data.nodes.find(n => n.id === id);
      if (nd) setDragOff({ x: e.clientX - (nd.x * scale + offset.x), y: e.clientY - (nd.y * scale + offset.y) });
    } else { setDragOff({ x: e.clientX, y: e.clientY }); }
  }, [data.nodes, scale, offset]);

  const onMove = useCallback((e) => {
    if (isPan) setOffset({ x: e.clientX - panSt.x, y: e.clientY - panSt.y });
    if (dragId && dragT === "node") {
      const nx = (e.clientX - dragOff.x - offset.x) / scale, ny = (e.clientY - dragOff.y - offset.y) / scale;
      setData(p => ({ ...p, nodes: p.nodes.map(n => n.id === dragId ? { ...n, x: nx, y: ny } : n) }));
    }
    if (dragId && dragT === "group") {
      const dx = (e.clientX - dragOff.x) / scale, dy = (e.clientY - dragOff.y) / scale;
      setDragOff({ x: e.clientX, y: e.clientY });
      setData(p => {
        const op = p.operationTypes.find(o => o.id === dragId);
        if (!op) return p;
        const ids = new Set([op.src_location_id, op.dest_location_id]);
        return { ...p, nodes: p.nodes.map(n => ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n) };
      });
    }
  }, [isPan, panSt, dragId, dragT, dragOff, offset, scale]);

  const onUp = useCallback(() => { setIsPan(false); setDragId(null); setDragT(null); }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const d = e.deltaY > 0 ? 0.93 : 1.07;
    const ns = Math.min(Math.max(scale * d, 0.2), 3);
    const r = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setOffset({ x: mx - ((mx - offset.x) / scale) * ns, y: my - ((my - offset.y) / scale) * ns });
    setScale(ns);
  }, [scale, offset]);

  const selRuleId = sel?.type === "rule" ? sel.id : null;

  return (
    <div style={{ width: "100%", height: "100vh", background: T.bg, fontFamily: "'IBM Plex Sans', sans-serif", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* TOOLBAR */}
      <div style={{ height: 44, background: T.surface, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", flexShrink: 0, zIndex: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 22, height: 22, borderRadius: 4, background: `linear-gradient(135deg, ${T.accent}, ${T.green})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>⌂</div>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Odoo Inventory Flow</span>
          <span style={{ fontSize: 9, color: T.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>
            {data.nodes.length}n · {data.operationTypes.length}op · {data.routes.length}r · {data.routes.reduce((a, r) => a + r.rules.length, 0)}rl
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <Btn small icon="add" onClick={() => setShowAdd(true)}>Add</Btn>
          <Btn small icon="api" onClick={() => setShowApi(true)}>API</Btn>
          <Btn small icon="settings" onClick={() => setShowCfg(true)} />
          <div style={{ width: 1, height: 18, background: T.border, alignSelf: "center", margin: "0 2px" }} />
          <Btn small variant="ghost" icon="fit" onClick={() => { setScale(0.72); setOffset({ x: 240, y: 30 }); }} />
          <div style={{ padding: "3px 7px", background: T.surfaceRaised, borderRadius: 3, border: `1px solid ${T.border}`, fontSize: 9, color: T.textDim, display: "flex", alignItems: "center", fontFamily: "'IBM Plex Mono', monospace" }}>{Math.round(scale * 100)}%</div>
        </div>
      </div>

      <div style={{ flex: 1, position: "relative", display: "flex" }}>
        {/* ROUTE SIDEBAR */}
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 210, background: `${T.surface}f0`, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", zIndex: 25, backdropFilter: "blur(8px)" }}>
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.text }}>Routes & Rules</div>
          <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
            {data.routes.map(route => {
              const rc = ROUTE_COLORS[route.colorIdx % ROUTE_COLORS.length];
              const h = hidden.has(route.id);
              return (
                <div key={route.id} style={{ marginBottom: 2 }}>
                  <div onClick={() => doSelect(route.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: rc.stroke, opacity: h ? 0.3 : 1, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: h ? T.textDim : T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{route.label}</span>
                    <button onClick={e => { e.stopPropagation(); addRuleToRoute(route.id); }} title="Add rule to this route" style={{ background: "none", border: "none", cursor: "pointer", padding: 1, display: "flex", opacity: 0.5 }}
                      onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.5}>
                      <SI d={ICONS.add} size={12} color={rc.stroke} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); setHidden(p => { const n = new Set(p); n.has(route.id) ? n.delete(route.id) : n.add(route.id); return n; }); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 1, display: "flex" }}>
                      <SI d={h ? ICONS.eyeOff : ICONS.eye} size={11} color={T.textDim} />
                    </button>
                  </div>
                  {!h && (<>
                    {route.rules.map(rule => (
                      <div key={rule.id} onClick={() => doSelect(rule.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 12px 4px 28px", cursor: "pointer", background: selRuleId === rule.id ? `${rc.stroke}15` : "transparent", borderLeft: selRuleId === rule.id ? `2px solid ${rc.stroke}` : "2px solid transparent" }}
                        onMouseEnter={e => { if (selRuleId !== rule.id) e.currentTarget.style.background = T.surfaceHover; }} onMouseLeave={e => { if (selRuleId !== rule.id) e.currentTarget.style.background = "transparent"; }}>
                        <span style={{ fontSize: 9, color: rc.stroke, fontFamily: "'IBM Plex Mono', monospace" }}>→</span>
                        <span style={{ fontSize: 9, color: T.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rule.label}</span>
                        <span style={{ fontSize: 7, color: T.textDim, marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace" }}>{rule.action}</span>
                      </div>
                    ))}
                    <div onClick={() => addRuleToRoute(route.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 12px 4px 28px", cursor: "pointer", borderLeft: "2px solid transparent", opacity: 0.45 }}
                      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; e.currentTarget.style.opacity = 0.8; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.opacity = 0.45; }}>
                      <SI d={ICONS.add} size={9} color={rc.stroke} />
                      <span style={{ fontSize: 8, color: rc.stroke, fontFamily: "'IBM Plex Mono', monospace" }}>Add rule</span>
                    </div>
                  </>)}
                </div>
              );
            })}
          </div>
          {/* Add route button at bottom */}
          <div style={{ padding: "8px 12px", borderTop: `1px solid ${T.border}` }}>
            <button onClick={() => doAdd("route")} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "7px 8px", background: "transparent", border: `1px dashed ${T.border}`, borderRadius: 5, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; e.currentTarget.style.borderColor = T.sky + "44"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = T.border; }}>
              <SI d={ICONS.add} size={11} color={T.sky} />
              <span style={{ fontSize: 9, fontWeight: 600, color: T.sky }}>New Route</span>
            </button>
          </div>
        </div>

        {/* SVG CANVAS */}
        <div style={{ flex: 1, marginLeft: 210, position: "relative" }}>
          <svg ref={svgRef} width="100%" height="100%" style={{ cursor: isPan ? "grabbing" : "default", background: T.bg }} onMouseDown={onCanvasDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onWheel={onWheel}>
            <defs>
              <pattern id="dots" width={24 * scale} height={24 * scale} patternUnits="userSpaceOnUse" x={offset.x % (24 * scale)} y={offset.y % (24 * scale)}>
                <circle cx={1} cy={1} r={0.5} fill={T.borderLight} fillOpacity={0.25} />
              </pattern>
              {["incoming", "outgoing", "internal"].map(c => {
                const col = { incoming: T.green, outgoing: T.rose, internal: T.amber }[c];
                return <marker key={c} id={`arr-${c}`} markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill={col} fillOpacity={0.25} /></marker>;
              })}
              {ROUTE_COLORS.map(rc => (
                <marker key={rc.stroke} id={`arr-r-${rc.stroke.replace('#', '')}`} markerWidth={10} markerHeight={7} refX={9} refY={3.5} orient="auto">
                  <path d="M0,0 L10,3.5 L0,7 Z" fill={rc.stroke} fillOpacity={0.7} />
                </marker>
              ))}
            </defs>
            <rect data-bg="true" width="100%" height="100%" fill="url(#dots)" />

            {/* OP TYPE GROUPS */}
            {data.operationTypes.map(op => {
              const sn = data.nodes.find(n => n.id === op.src_location_id);
              const dn = data.nodes.find(n => n.id === op.dest_location_id);
              if (!sn || !dn) return null;
              const pad = 30;
              const mx = Math.min(sn.x, dn.x) - pad, my = Math.min(sn.y, dn.y) - pad - 20;
              const mxr = Math.max(sn.x + NW, dn.x + NW) + pad, myr = Math.max(sn.y + NH, dn.y + NH) + pad;
              const sx = mx * scale + offset.x, sy = my * scale + offset.y;
              const sw = (mxr - mx) * scale, sh = (myr - my) * scale;
              const col = { incoming: T.green, outgoing: T.rose, internal: T.amber }[op.code] || T.amber;
              const isSel = sel?.id === op.id;
              const { sp, dp, ss, ds } = bestPorts(sn, dn);
              const p1 = { x: sp.x * scale + offset.x, y: sp.y * scale + offset.y };
              const p2 = { x: dp.x * scale + offset.x, y: dp.y * scale + offset.y };

              return (
                <g key={op.id} onMouseDown={e => { if (e.target.getAttribute("data-gbg")) { e.stopPropagation(); doSelect(op.id); onDragStart(op.id, e, "group"); } }}>
                  <rect data-gbg="true" x={sx} y={sy} width={sw} height={sh} rx={10 * scale} fill={`${col}06`} stroke={col} strokeWidth={isSel ? 1.5 : 1} strokeDasharray={`${6 * scale} ${4 * scale}`} strokeOpacity={isSel ? 0.7 : 0.2} style={{ cursor: "grab" }} />
                  <foreignObject x={sx + 8 * scale} y={sy + 4 * scale} width={sw - 16 * scale} height={18 * scale}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, pointerEvents: "none" }}>
                      <span style={{ fontSize: 8 * Math.max(scale, 0.7), fontWeight: 700, color: col, textTransform: "uppercase", letterSpacing: "0.7px", fontFamily: "'IBM Plex Mono', monospace", opacity: 0.8 }}>⛁ {op.label}</span>
                      <span style={{ fontSize: 7 * Math.max(scale, 0.7), color: T.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>{op.sequence_code}</span>
                    </div>
                  </foreignObject>
                  <path d={bPath(p1, p2, ss, ds)} fill="none" stroke={col} strokeWidth={1.3} strokeOpacity={0.15} strokeDasharray="4 3" markerEnd={`url(#arr-${op.code})`} />
                </g>
              );
            })}

            {/* ROUTE RULE EDGES */}
            {(() => {
              const bidirMap = buildBidirectionalMap(data.routes);
              return data.routes.map(route => {
                if (hidden.has(route.id)) return null;
                const rc = ROUTE_COLORS[route.colorIdx % ROUTE_COLORS.length];
                return route.rules.map(rule => {
                  const sn = data.nodes.find(n => n.id === rule.src_location_id);
                  const dn = data.nodes.find(n => n.id === rule.dest_location_id);
                  if (!sn || !dn) return null;
                  const { sp, dp, ss, ds } = bestPorts(sn, dn);
                  const p1 = { x: sp.x * scale + offset.x, y: sp.y * scale + offset.y };
                  const p2 = { x: dp.x * scale + offset.x, y: dp.y * scale + offset.y };
                  
                  // Check if this rule has a bidirectional counterpart
                  const key = `${rule.src_location_id}→${rule.dest_location_id}`;
                  const revKey = `${rule.dest_location_id}→${rule.src_location_id}`;
                  const isBidirectional = bidirMap.has(revKey) && bidirMap.get(revKey).reverse !== null;
                  const curveOff = getCurveOffset(rule.id, data.routes, bidirMap, isBidirectional);
                  
                  const d = bPath(p1, p2, ss, ds, curveOff);
                  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 - 10 };
                  const isSel = sel?.id === rule.id;
                  return (
                    <g key={rule.id} onClick={e => { e.stopPropagation(); doSelect(rule.id); }} style={{ cursor: "pointer" }}>
                      <path d={d} fill="none" stroke={rc.stroke} strokeWidth={isSel ? 6 : 3} strokeOpacity={isSel ? 0.2 : 0.05} />
                      <path d={d} fill="none" stroke={rc.stroke} strokeWidth={isSel ? 2.5 : 1.8} strokeOpacity={isSel ? 1 : 0.5} markerEnd={`url(#arr-r-${rc.stroke.replace('#', '')})`} />
                      <foreignObject x={mid.x - 50} y={mid.y - 8} width={100} height={18}>
                        <div style={{ display: "flex", justifyContent: "center", pointerEvents: "none" }}>
                          <span style={{ fontSize: 8 * Math.max(scale, 0.7), fontWeight: 600, color: rc.stroke, background: `${T.bg}dd`, padding: "1px 5px", borderRadius: 2, fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>{rule.label}</span>
                        </div>
                      </foreignObject>
                    </g>
                  );
                });
              });
            })()}

            {/* NODES */}
            {data.nodes.map(node => {
              const s = nodeStyles[node.type] || nodeStyles.location;
              const sx = node.x * scale + offset.x, sy = node.y * scale + offset.y;
              const isSel = sel?.id === node.id;
              const paCount = node.type === "location" ? data.putawayRules.filter(r => r.location_in_id === node.id).length : 0;
              return (
                <g key={node.id} onMouseDown={e => { e.stopPropagation(); doSelect(node.id); onDragStart(node.id, e, "node"); }} style={{ cursor: "grab" }}>
                  <rect x={sx} y={sy} width={NW * scale} height={NH * scale} rx={5 * scale} fill={T.surface} stroke={isSel ? "#fff" : s.color} strokeWidth={isSel ? 1.6 : 0.8} strokeOpacity={isSel ? 1 : 0.4} />
                  <rect x={sx} y={sy + 5 * scale} width={2.5 * scale} height={(NH - 10) * scale} rx={1.2 * scale} fill={s.color} fillOpacity={0.6} />
                  <text x={sx + 14 * scale} y={sy + NH / 2 * scale} fontSize={12 * Math.max(scale, 0.55)} fill={s.color} textAnchor="middle" dominantBaseline="central">{s.icon}</text>
                  <text x={sx + 26 * scale} y={sy + (node.data?.usage ? NH * 0.36 : NH / 2) * scale} fontSize={10.5 * Math.max(scale, 0.55)} fontWeight={600} fill={T.text} fontFamily="'IBM Plex Sans', sans-serif" dominantBaseline="central">
                    {node.label.length > 18 ? node.label.slice(0, 18) + "…" : node.label}
                  </text>
                  {node.data?.usage && (
                    <text x={sx + 26 * scale} y={sy + NH * 0.66 * scale} fontSize={7.5 * Math.max(scale, 0.55)} fill={T.textDim} fontFamily="'IBM Plex Mono', monospace" dominantBaseline="central">{node.data.usage}</text>
                  )}
                  {["l", "r", "t", "b"].map(side => { const p = nodePort(node, side); return <circle key={side} cx={p.x * scale + offset.x} cy={p.y * scale + offset.y} r={2.5 * scale} fill={T.surface} stroke={s.color} strokeWidth={1} strokeOpacity={0.3} />; })}
                  {/* Putaway button on location nodes */}
                  {node.type === "location" && node.data?.usage === "internal" && (
                    <g onClick={e => { e.stopPropagation(); setPutawayLoc(node.id); }} style={{ cursor: "pointer" }}>
                      <rect x={sx + (NW - 22) * scale} y={sy + 2 * scale} width={20 * scale} height={14 * scale} rx={3 * scale}
                        fill={paCount > 0 ? T.violetSoft : T.surfaceRaised} stroke={T.violet} strokeWidth={0.6} strokeOpacity={paCount > 0 ? 0.6 : 0.2} />
                      <text x={sx + (NW - 12) * scale} y={sy + 10.5 * scale} fontSize={7 * Math.max(scale, 0.6)} fill={T.violet} textAnchor="middle" dominantBaseline="central" fontFamily="'IBM Plex Mono', monospace" fontWeight={600}>
                        ⇲{paCount > 0 ? paCount : ""}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* LEGEND */}
          <div style={{ position: "absolute", bottom: 8, right: (sel && !putawayLoc) ? 340 : putawayLoc ? 410 : 8, padding: "6px 10px", background: `${T.surface}dd`, border: `1px solid ${T.border}`, borderRadius: 5, zIndex: 20, display: "flex", gap: 10, fontSize: 8, color: T.textSoft, fontFamily: "'IBM Plex Mono', monospace", transition: "right 0.2s" }}>
            <span>◎ location</span><span>⌂ warehouse</span>
            <span style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: 8 }}>
              <span style={{ color: T.amber }}>╌╌</span> op-type group
            </span>
            <span style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: 8 }}>
              <span style={{ color: T.accent }}>━━</span> route rule
            </span>
            <span style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: 8 }}>
              <span style={{ color: T.violet }}>⇲</span> putaway (on node)
            </span>
          </div>
        </div>

        {/* PROPERTY PANEL */}
        {sel && !putawayLoc && <PropPanel sel={sel} data={data} onUpdate={doUpdate} onClose={() => setSel(null)} onDelete={doDelete} />}

        {/* PUTAWAY PANEL */}
        {putawayLoc && (() => {
          const loc = data.nodes.find(n => n.id === putawayLoc);
          return loc ? (
            <PutawayPanel
              locationId={putawayLoc}
              locationLabel={loc.label}
              rules={data.putawayRules}
              onUpdate={putawayUpdate}
              onAdd={putawayAdd}
              onDelete={putawayDelete}
              onClose={() => setPutawayLoc(null)}
            />
          ) : null;
        })()}
      </div>

      {/* MODALS */}
      {showCfg && <CfgModal cfg={apiCfg} onChange={setApiCfg} onClose={() => setShowCfg(false)} />}
      {showAdd && <AddModal onAdd={doAdd} routes={data.routes} onAddRule={addRuleToRoute} onClose={() => setShowAdd(false)} />}
      {showApi && <ApiPanel data={data} apiConfig={apiCfg} onClose={() => setShowApi(false)} />}
    </div>
  );
}
