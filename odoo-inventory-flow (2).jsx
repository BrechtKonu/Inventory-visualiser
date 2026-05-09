// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Author: Brecht Soenen (moral rights retained — art. XI.165 §2 WER).
// Proprietary — use governed by the LICENSE file in the project root.

import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { presetGenerator, presetDiff } from "./src/warehouse-presets.js";
import { exportMarkdown } from "./src/markdown-exporter.js";
import { simulatePutaway } from "./src/putaway-simulator.js";

// ─── THEMES ──────────────────────────────────────────────────────────────────
const DARK_THEME = {
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
const LIGHT_THEME = {
  bg: "#f0f4f8",
  surface: "#ffffff",
  surfaceRaised: "#f8fafc",
  surfaceHover: "#f1f5f9",
  border: "#dde3ec",
  borderLight: "#e8edf5",
  text: "#1a2332",
  textSoft: "#546578",
  textDim: "#94a3b8",
  accent: "#4b6ef5",
  accentSoft: "rgba(75,110,245,0.12)",
  green: "#059669",
  greenSoft: "rgba(5,150,105,0.12)",
  amber: "#d97706",
  amberSoft: "rgba(217,119,6,0.10)",
  rose: "#e11d48",
  roseSoft: "rgba(225,29,72,0.10)",
  sky: "#0284c7",
  violet: "#7c3aed",
  violetSoft: "rgba(124,58,237,0.10)",
};
// Mutable theme object — updated via Object.assign in App before each render
const T = { ...DARK_THEME };

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

// Mutable — refreshed from T in App before each render
const nodeStyles = {
  warehouse: { color: T.accent, bg: T.accentSoft, icon: "⌂" },
  location: { color: T.green, bg: T.greenSoft, icon: "◎" },
  operation_type: { color: T.amber, bg: T.amberSoft, icon: "⛁" },
  route: { color: T.sky, bg: T.accentSoft, icon: "⚡" },
  putaway_rule: { color: T.violet, bg: T.violetSoft, icon: "⇲" },
};
function syncTheme(isDark) {
  Object.assign(T, isDark ? DARK_THEME : LIGHT_THEME);
  nodeStyles.warehouse.color = T.accent; nodeStyles.warehouse.bg = T.accentSoft;
  nodeStyles.location.color = T.green;   nodeStyles.location.bg = T.greenSoft;
  nodeStyles.operation_type.color = T.amber; nodeStyles.operation_type.bg = T.amberSoft;
  nodeStyles.route.color = T.sky;        nodeStyles.route.bg = T.accentSoft;
  nodeStyles.putaway_rule.color = T.violet; nodeStyles.putaway_rule.bg = T.violetSoft;
}

// Resolve the visual style for any node — diverges by `data.usage` for locations
// so each Odoo usage type reads at a glance:
//   internal  → blue rect          (real stock)
//   supplier  → green pill         (vendors, partner-side, external)
//   customer  → rose pill          (customers, partner-side, external)
//   transit   → amber dashed pill  (inter-WH bridge)
//   production→ violet dashed rect (virtual MO consumption/production)
//   inventory → grey dotted rect   (virtual scrap / adjustments)
//   view      → grey dashed rect   (parent container — gets its own blob layer)
function nodeVisual(node) {
  if (node.type === "warehouse")    return { color: T.accent, bg: T.accentSoft, icon: "⌂", shape: "rect", border: "solid",  external: false };
  if (node.type === "putaway_rule") return { color: T.violet, bg: T.violetSoft, icon: "⇲", shape: "rect", border: "solid",  external: false };
  // location
  const u = node.data?.usage || "internal";
  switch (u) {
    case "supplier":   return { color: T.green,       bg: T.greenSoft,    icon: "⇲", shape: "pill",   border: "solid",  external: true };
    case "customer":   return { color: T.rose,        bg: T.roseSoft,     icon: "🛒", shape: "pill",  border: "solid",  external: true };
    case "transit":    return { color: T.amber,       bg: T.amberSoft,    icon: "↔", shape: "pill",   border: "dashed", external: false };
    case "production": return { color: T.violet,      bg: T.violetSoft,   icon: "⚙", shape: "rect",   border: "dashed", external: false, virtual: true };
    case "inventory":  return { color: T.textDim,     bg: T.surfaceRaised,icon: "⊗", shape: "rect",   border: "dotted", external: false, virtual: true };
    case "view":       return { color: T.textSoft,    bg: "transparent",  icon: "▢", shape: "rect",   border: "dashed", external: false, isView: true };
    case "internal":
    default:           return { color: T.accent,      bg: T.accentSoft,   icon: "◎", shape: "rect",   border: "solid",  external: false };
  }
}
function dashFor(border, scale) {
  if (border === "dashed") return `${5 * scale} ${3 * scale}`;
  if (border === "dotted") return `${1.5 * scale} ${2.5 * scale}`;
  return undefined;
}

// ─── DOMAIN PRESETS ─────────────────────────────────────────────────────────
// Common Odoo domain expressions for push-rule applicability. Organized into
// category buckets; the helper UI renders each bucket as a collapsible group.
// Each entry is a single condition tuple; "Wrap in [...]" turns the
// comma-joined result into a valid Odoo domain list.
//
// Field-accuracy note: push-rule domains in Odoo 17+ are evaluated against
// stock.move records. Product fields are reachable via `product_id.<field>`;
// product.template fields via `product_id.product_tmpl_id.<field>`.
// Some presets use customer-specific fields (e.g. shelf-life) — flagged with
// "(non-standard)" so users know to swap in their actual field path.
//
// TODO: cross-verify against ~/odoo/19.0/odoo/addons/stock/ when Odoo source
// is available on this machine. Several presets reference fields that exist
// in stock.module + quality.module enterprise; verify trimmed/non-standard.
const DOMAIN_PRESETS = [
  {
    category: "Product properties",
    presets: [
      { label: "tracked product only", description: "Lot/serial-tracked items only", expression: "('product_id.tracking', 'in', ('lot', 'serial'))" },
      { label: "needs expiration", description: "Perishable products with shelf life", expression: "('product_id.use_expiration_date', '=', True)" },
      { label: "has product tag", description: "Tag-driven applicability (edit tag name)", expression: "('product_id.product_tag_ids.name', '=', 'priority')" },
      { label: "product category", description: "Category-level rule (edit name)", expression: "('product_id.categ_id.complete_name', 'ilike', 'Electronics')" },
      { label: "high-value", description: "Above price threshold (edit threshold)", expression: "('product_id.list_price', '>', 1000)" },
      { label: "heavy", description: "Weight threshold for pallet routing (kg)", expression: "('product_id.weight', '>', 25)" },
      { label: "bulky", description: "Volume threshold (m³)", expression: "('product_id.volume', '>', 0.5)" },
      { label: "storable only", description: "Skip services and consumables", expression: "('product_id.type', '=', 'product')" },
      { label: "sellable", description: "Sellable products", expression: "('product_id.sale_ok', '=', True)" },
      { label: "purchasable", description: "Purchasable products", expression: "('product_id.purchase_ok', '=', True)" },
      { label: "has variants", description: "Template with attribute variants", expression: "('product_id.product_tmpl_id.attribute_line_ids', '!=', False)" },
      { label: "has BOM", description: "Manufacturable (has Bill of Materials)", expression: "('product_id.product_tmpl_id.bom_ids', '!=', False)" },
    ],
  },
  {
    category: "Move source / context",
    presets: [
      { label: "has QC route", description: "Product is on a Quality Control route", expression: "('product_id.route_ids.name', 'ilike', 'Quality')" },
      { label: "stock in location", description: "Product has stock somewhere (edit location name)", expression: "('product_id.stock_quant_ids.location_id.complete_name', 'ilike', 'WH/Stock')" },
      { label: "from specific vendor", description: "From a specific vendor (edit name)", expression: "('move_id.partner_id.name', 'ilike', 'Acme')" },
      { label: "returned from customer", description: "Returns from customer location (refurb routing)", expression: "('move_id.location_id.usage', '=', 'customer')" },
      { label: "drop-shipping", description: "Direct supplier→customer move", expression: "('move_id.location_id.usage', '=', 'supplier'), ('move_id.location_dest_id.usage', '=', 'customer')" },
      { label: "user's company", description: "Restrict to current user's company", expression: "('company_id', '=', user.company_id.id)" },
    ],
  },
  {
    category: "Triggering doc",
    presets: [
      { label: "manufactured here", description: "Output of a manufacturing order", expression: "('move_id.production_id', '!=', False)" },
      { label: "from purchase order", description: "Vendor receipt only", expression: "('move_id.purchase_line_id', '!=', False)" },
      { label: "sales-driven", description: "Customer-order-driven moves", expression: "('move_id.sale_line_id', '!=', False)" },
      { label: "specific carrier", description: "Delivery via specific carrier (edit name)", expression: "('move_id.picking_id.carrier_id.name', 'ilike', 'DHL')" },
      { label: "urgent priority", description: "High-priority moves (priority='1')", expression: "('move_id.priority', '=', '1')" },
      { label: "reorder rule active", description: "Has an active orderpoint", expression: "('product_id.orderpoint_ids.active', '=', True)" },
    ],
  },
  {
    category: "Special cases",
    presets: [
      { label: "first receipt of product", description: "Never purchased before — initial QC always", expression: "('product_id.last_purchase_date', '=', False)" },
      { label: "quality alert open", description: "Block until QA team closes the alert (enterprise)", expression: "('product_id.quality_alert_count', '>', 0)" },
      { label: "route active", description: "Only when route is active", expression: "('route_ids.active', '=', True)" },
      { label: "barcode prefix match", description: "Location/product barcode starts with X", expression: "('product_id.barcode', '=like', 'COLD-%')" },
      { label: "needs serial number", description: "Serial-tracked products only", expression: "('product_id.tracking', '=', 'serial')" },
      { label: "below reorder min", description: "Free qty below orderpoint min", expression: "('product_id.qty_available', '<', product_id.orderpoint_ids.product_min_qty)" },
    ],
  },
];

// ─── FIELD DEFINITIONS ──────────────────────────────────────────────────────
// Field types:
//   text, number, boolean, select (with options)
//   m2o   { source: 'location'|'warehouse'|'route'|'operation_type' } — dropdown from current data
//   ref   { hint } — free-text reference to an external Odoo record (product, partner, …)
//   m2m   { source } — comma-separated tag list
//   domain_helper — multiline text + preset insert buttons (Odoo domain expression)
//   group:<name> — section header (no input)
const fieldDefs = {
  warehouse: [
    { key: "__group_basic", type: "group", label: "Basic" },
    { key: "code", label: "Short Code", type: "text" },
    { key: "name", label: "Warehouse Name", type: "text" },
    { key: "active", label: "Active", type: "boolean" },
    { key: "sequence", label: "Sequence", type: "number" },
    { key: "partner_id", label: "Address", type: "ref", hint: "res.partner" },
    { key: "company_id", label: "Company", type: "ref", hint: "res.company" },
    { key: "__group_steps", type: "group", label: "Routings" },
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
    { key: "manufacture_steps", label: "Manufacture Steps", type: "select", options: [
      { value: "mrp_one_step", label: "Manufacture (1 step)" },
      { value: "pbm", label: "Pick + Manufacture (2 steps)" },
      { value: "pbm_sam", label: "Pick + Manufacture + Store (3 steps)" },
    ]},
    { key: "__group_resupply", type: "group", label: "Resupply" },
    { key: "buy_to_resupply", label: "Buy to Resupply", type: "boolean" },
    { key: "manufacture_to_resupply", label: "Manufacture to Resupply", type: "boolean" },
    { key: "resupply_wh_ids", label: "Resupply Warehouses", type: "m2m", source: "warehouse" },
  ],
  location: [
    { key: "__group_basic", type: "group", label: "Basic" },
    { key: "complete_name", label: "Full Name", type: "text" },
    { key: "name", label: "Short Name", type: "text" },
    { key: "active", label: "Active", type: "boolean" },
    { key: "location_id", label: "Parent Location", type: "m2o", source: "location" },
    { key: "usage", label: "Location Type", type: "select", options: [
      { value: "supplier", label: "Vendor" }, { value: "internal", label: "Internal" },
      { value: "customer", label: "Customer" }, { value: "inventory", label: "Inventory Loss" },
      { value: "production", label: "Production" }, { value: "transit", label: "Transit" },
      { value: "view", label: "View" },
    ]},
    { key: "barcode", label: "Barcode", type: "text" },
    { key: "company_id", label: "Company", type: "ref", hint: "res.company" },
    { key: "__group_logistics", type: "group", label: "Logistics" },
    { key: "removal_strategy_id", label: "Removal Strategy", type: "select", options: [
      { value: "fifo", label: "FIFO" }, { value: "lifo", label: "LIFO" },
      { value: "closest", label: "Closest" }, { value: "least_packages", label: "Least Packages" },
      { value: "fefo", label: "FEFO" },
    ]},
    { key: "removal_strategy", label: "Removal (legacy)", type: "select", options: [
      { value: "", label: "—" },
      { value: "fifo", label: "FIFO" }, { value: "lifo", label: "LIFO" },
      { value: "closest", label: "Closest" }, { value: "least_packages", label: "Least Packages" },
      { value: "fefo", label: "FEFO" },
    ]},
    { key: "storage_category_id", label: "Storage Category", type: "m2o", source: "storage_category" },
    { key: "capacity_qty", label: "Capacity (units)", type: "number", hint: "Max units of product this location holds" },
    { key: "capacity_packages", label: "Capacity (packages)", type: "number", hint: "Max packages/pallets this location holds" },
    { key: "capacity", label: "Capacity (legacy)", type: "number", hint: "Legacy single-field capacity — superseded by capacity_qty/packages" },
    { key: "scrap_location", label: "Scrap Location", type: "boolean" },
    { key: "return_location", label: "Return Location", type: "boolean" },
    { key: "replenish_location", label: "Replenish Location", type: "boolean" },
    { key: "__group_inventory", type: "group", label: "Cyclic Inventory" },
    { key: "cyclic_inventory_frequency", label: "Frequency (days)", type: "number" },
    { key: "last_inventory_date", label: "Last Inventory", type: "text" },
    { key: "next_inventory_date", label: "Next Inventory", type: "text" },
    { key: "__group_layout", type: "group", label: "Map Position" },
    { key: "posx", label: "Position X (m)", type: "number" },
    { key: "posy", label: "Position Y (m)", type: "number" },
    { key: "posz", label: "Position Z / Level", type: "number" },
    { key: "comment", label: "Notes", type: "text" },
  ],
  operation_type: [
    { key: "__group_basic", type: "group", label: "Basic" },
    { key: "name", label: "Operation Name", type: "text" },
    { key: "active", label: "Active", type: "boolean" },
    { key: "code", label: "Type", type: "select", options: [
      { value: "incoming", label: "Receipt" }, { value: "outgoing", label: "Delivery" },
      { value: "internal", label: "Internal Transfer" }, { value: "mrp_operation", label: "Manufacturing" },
    ]},
    { key: "sequence_code", label: "Sequence Prefix", type: "text" },
    { key: "warehouse_id", label: "Warehouse", type: "m2o", source: "warehouse" },
    { key: "company_id", label: "Company", type: "ref", hint: "res.company" },
    { key: "color", label: "Kanban Color", type: "number" },
    { key: "__group_locations", type: "group", label: "Default Locations" },
    { key: "default_location_return_id", label: "Return Location", type: "m2o", source: "location" },
    { key: "return_picking_type_id", label: "Return Picking Type", type: "m2o", source: "operation_type" },
    { key: "__group_behavior", type: "group", label: "Behavior" },
    { key: "create_backorder", label: "Backorder", type: "select", options: [
      { value: "ask", label: "Ask" }, { value: "always", label: "Always" }, { value: "never", label: "Never" },
    ]},
    { key: "reservation_method", label: "Reservation Method", type: "select", options: [
      { value: "at_confirm", label: "At Confirmation" }, { value: "manual", label: "Manual" },
      { value: "by_date", label: "Before scheduled date" },
    ]},
    { key: "reservation_days_before", label: "Reserve N days before", type: "number" },
    { key: "reservation_days_before_priority", label: "Reserve N days (priority)", type: "number" },
    { key: "__group_lots", type: "group", label: "Lots & Serials" },
    { key: "use_create_lots", label: "Create New Lots", type: "boolean" },
    { key: "use_existing_lots", label: "Use Existing Lots", type: "boolean" },
    { key: "use_create_components_lots", label: "Create Component Lots", type: "boolean" },
    { key: "prefill_lot_tail", label: "Prefill Lot Tail", type: "boolean" },
    { key: "__group_display", type: "group", label: "Display" },
    { key: "show_operations", label: "Show Detailed Operations", type: "boolean" },
    { key: "show_reserved", label: "Show Reserved", type: "boolean" },
    { key: "show_entire_packs", label: "Show Entire Packs", type: "boolean" },
    { key: "auto_show_reception_report", label: "Auto Reception Report", type: "boolean" },
    { key: "__group_print", type: "group", label: "Auto-Print" },
    { key: "print_label", label: "Print Label", type: "boolean" },
    { key: "auto_print_delivery_slip", label: "Print Delivery Slip", type: "boolean" },
    { key: "auto_print_lot_labels", label: "Print Lot Labels", type: "boolean" },
    { key: "auto_print_product_labels", label: "Print Product Labels", type: "boolean" },
    { key: "copy_attachments", label: "Copy Attachments", type: "boolean" },
    { key: "barcode", label: "Barcode", type: "text" },
  ],
  route: [
    { key: "__group_basic", type: "group", label: "Basic" },
    { key: "name", label: "Route Name", type: "text" },
    { key: "active", label: "Active", type: "boolean" },
    { key: "sequence", label: "Sequence", type: "number" },
    { key: "company_id", label: "Company", type: "ref", hint: "res.company" },
    { key: "__group_applicability", type: "group", label: "Applicability" },
    { key: "product_selectable", label: "Applicable on Product", type: "boolean" },
    { key: "product_categ_selectable", label: "Applicable on Category", type: "boolean" },
    { key: "warehouse_selectable", label: "Applicable on Warehouse", type: "boolean" },
    { key: "packaging_selectable", label: "Applicable on Packaging", type: "boolean" },
    { key: "sale_selectable", label: "Applicable on SO", type: "boolean" },
    { key: "__group_targets", type: "group", label: "Selected Targets" },
    { key: "product_ids", label: "Products", type: "m2m", source: "product", hint: "comma-separated names" },
    { key: "categ_ids", label: "Categories", type: "m2m", source: "category" },
    { key: "packaging_ids", label: "Packagings", type: "m2m", source: "packaging" },
    { key: "warehouse_ids", label: "Warehouses", type: "m2m", source: "warehouse" },
    { key: "__group_resupply", type: "group", label: "Resupply (inter-WH)" },
    { key: "supplied_wh_id", label: "Supplied Warehouse", type: "m2o", source: "warehouse" },
    { key: "supplier_wh_id", label: "Supplier Warehouse", type: "m2o", source: "warehouse" },
  ],
  rule: [
    { key: "__group_basic", type: "group", label: "Basic" },
    { key: "name", label: "Description", type: "text" },
    { key: "active", label: "Active", type: "boolean" },
    { key: "sequence", label: "Sequence", type: "number" },
    { key: "warehouse_id", label: "Warehouse", type: "m2o", source: "warehouse" },
    { key: "company_id", label: "Company", type: "ref", hint: "res.company" },
    { key: "__group_action", type: "group", label: "Action" },
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
      { value: "manual", label: "Manual (no schedule)" },
      { value: "transparent", label: "Automatic No Step Added" },
    ]},
    { key: "delay", label: "Delay (days)", type: "number" },
    { key: "__group_propagation", type: "group", label: "Propagation" },
    { key: "propagate_cancel", label: "Propagate Cancel", type: "boolean" },
    { key: "propagate_carrier", label: "Propagate Carrier", type: "boolean" },
    { key: "group_propagation_option", label: "Procurement Group", type: "select", options: [
      { value: "none", label: "Leave Empty" },
      { value: "propagate", label: "Propagate" },
      { value: "fixed", label: "Fixed" },
    ]},
    { key: "group_id", label: "Fixed Group", type: "ref", hint: "procurement.group" },
    { key: "partner_address_id", label: "Delivery Address", type: "ref", hint: "res.partner" },
    { key: "location_dest_from_rule", label: "Take dest from another rule", type: "boolean" },
    { key: "__group_applicability", type: "group", label: "Applicability" },
    { key: "domain", label: "Domain", type: "domain_helper", hint: "Odoo domain for push-rule applicability" },
  ],
  putaway_rule: [
    { key: "sequence", label: "Priority", type: "number" },
    { key: "active", label: "Active", type: "boolean" },
    { key: "product_id", label: "Product", type: "ref", hint: "product.product" },
    { key: "category_id", label: "Product Category", type: "ref", hint: "product.category" },
    { key: "package_type_ids", label: "Package Types", type: "m2m", source: "package_type" },
    { key: "storage_category_id", label: "Storage Category", type: "ref", hint: "stock.storage.category" },
    { key: "storage_strategy", label: "Storage Strategy", type: "select", options: [
      { value: "manual_no_strategy", label: "Manual (no auto)" },
      { value: "closest_location", label: "Closest location" },
      { value: "least_packages", label: "Least packages" },
    ]},
    { key: "location_in_id", label: "When arriving in", type: "m2o", source: "location" },
    { key: "location_out_id", label: "Store to sublocation", type: "ref", hint: "stock.location (full path)" },
    { key: "sublocation", label: "Sub-location strategy", type: "select", options: [
      { value: "no", label: "—" },
      { value: "last_used", label: "Last used" },
      { value: "closest_location", label: "Closest" },
    ]},
    { key: "company_id", label: "Company", type: "ref", hint: "res.company" },
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
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ flexShrink: 0 }}>
    <path d={d} stroke={color} strokeWidth={0.6} strokeLinejoin="round" />
  </svg>
);

const Btn = ({ children, onClick, variant = "default", small, icon, disabled, title, style = {}, compact }) => {
  const v = {
    default: { background: T.surfaceRaised, color: T.text, border: `1px solid ${T.border}` },
    primary: { background: T.accent, color: "#fff", border: "none" },
    danger: { background: T.roseSoft, color: T.rose, border: `1px solid ${T.rose}33` },
    ghost: { background: "transparent", color: T.textSoft, border: "none" },
  };
  // In compact mode, drop the text label IF there's an icon to identify the button.
  // Buttons without an icon keep their children as the only visual cue.
  const showChildren = !compact || !icon;
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      padding: small ? (compact && icon ? "5px 7px" : "5px 8px") : "7px 13px", borderRadius: 5, fontSize: small ? 11.5 : 12.5,
      fontWeight: icon ? 600 : 700, cursor: disabled ? "not-allowed" : "pointer", display: "inline-flex",
      alignItems: "center", gap: showChildren && icon ? 5 : 0, opacity: disabled ? 0.4 : 1,
      fontFamily: "'IBM Plex Sans', sans-serif", transition: "background 0.15s",
      ...v[variant], ...style,
    }}>
      {icon && <SI d={ICONS[icon]} size={small ? 15 : 17} />}{showChildren && children}
    </button>
  );
};

const Badge = ({ children, color = T.accent }) => (
  <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color, background: `${color}1a` }}>{children}</span>
);

// ─── GEOMETRY HELPERS ───────────────────────────────────────────────────────
const NW = 200, NH = 64; // node width/height — bumped for legibility & easier click target
function nodeCenter(n) { return { x: n.x + NW / 2, y: n.y + NH / 2 }; }
function nodePort(n, side) {
  switch (side) {
    case "r":  return { x: n.x + NW,     y: n.y + NH / 2 };
    case "l":  return { x: n.x,          y: n.y + NH / 2 };
    case "t":  return { x: n.x + NW / 2, y: n.y };
    case "b":  return { x: n.x + NW / 2, y: n.y + NH };
    case "tl": return { x: n.x,          y: n.y };
    case "tr": return { x: n.x + NW,     y: n.y };
    case "bl": return { x: n.x,          y: n.y + NH };
    case "br": return { x: n.x + NW,     y: n.y + NH };
    default:   return nodeCenter(n);
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
function bezierCtl(p1, p2, s1, s2, curveOffset = 0) {
  const dist = Math.max(40, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.35);
  const off = { r: { x: dist, y: 0 }, l: { x: -dist, y: 0 }, b: { x: 0, y: dist }, t: { x: 0, y: -dist } };
  const c1 = { x: p1.x + (off[s1]?.x || 0), y: p1.y + (off[s1]?.y || 0) };
  const c2 = { x: p2.x + (off[s2]?.x || 0), y: p2.y + (off[s2]?.y || 0) };
  if (curveOffset !== 0) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    c1.x += nx * curveOffset; c1.y += ny * curveOffset;
    c2.x += nx * curveOffset; c2.y += ny * curveOffset;
  }
  return { c1, c2 };
}
function bPath(p1, p2, s1, s2, curveOffset = 0) {
  const { c1, c2 } = bezierCtl(p1, p2, s1, s2, curveOffset);
  return `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
}
function bezierPoint(p1, p2, s1, s2, curveOffset, t) {
  const { c1, c2 } = bezierCtl(p1, p2, s1, s2, curveOffset);
  const mt = 1 - t;
  return {
    x: mt*mt*mt*p1.x + 3*mt*mt*t*c1.x + 3*mt*t*t*c2.x + t*t*t*p2.x,
    y: mt*mt*mt*p1.y + 3*mt*mt*t*c1.y + 3*mt*t*t*c2.y + t*t*t*p2.y,
  };
}
// Hash a string into a stable HSL color — each op-type gets its own legend hue
// so multiple internals (or multiple incomings) don't all share one color.
function hashColor(str, sat = 60, light = 48) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360}, ${sat}%, ${light}%)`;
}

// Action → (dash pattern, glyph at midpoint, tooltip prefix)
const ACTION_META = {
  pull:        { dash: 0,        glyph: null, label: "PULL" },
  push:        { dash: [5, 3],   glyph: null, label: "PUSH" },
  pull_push:   { dash: [1, 3],   glyph: null, label: "PULL+PUSH" },
  buy:         { dash: 0,        glyph: "$",  label: "BUY" },
  manufacture: { dash: 0,        glyph: "⚙",  label: "MANUFACTURE" },
};

// ─── SAMPLE DATA ────────────────────────────────────────────────────────────
const L = (id, label, x, y, usage, extra = {}) => ({ id, type: "location", label, x, y, data: { complete_name: label, usage, scrap_location: false, replenish_location: false, removal_strategy: "fifo", barcode: "", ...extra }});
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
      data: { name: "WH: Receive in 3 steps", active: true, product_selectable: false, product_categ_selectable: false, warehouse_selectable: true, sale_selectable: false, },
      rules: [
        { id: "rl-r3a", label: "Vendors → Input", action: "pull", procure_method: "make_to_order", src_location_id: "loc-vendors", dest_location_id: "loc-input", picking_type_id: "op-receipt", auto: "manual", data: { name: "Vendors → Input", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: false, delay: 0 }},
        { id: "rl-r3b", label: "Input → QC", action: "pull", procure_method: "make_to_order", src_location_id: "loc-input", dest_location_id: "loc-qc", picking_type_id: "op-qc", auto: "manual", data: { name: "Input → QC", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: false, delay: 0 }},
        { id: "rl-r3c", label: "QC → Stock", action: "pull", procure_method: "make_to_stock", src_location_id: "loc-qc", dest_location_id: "loc-stock", picking_type_id: "op-store", auto: "manual", data: { name: "QC → Stock", action: "pull", procure_method: "make_to_stock", auto: "manual", propagate_cancel: false, delay: 0 }},
      ]},
    // ── Pick-Pack-Ship (web orders)
    { id: "route-pps", label: "Pick → Pack → Ship (Web)", colorIdx: 1,
      data: { name: "WH: Pick Pack Ship", active: true, product_selectable: false, product_categ_selectable: false, warehouse_selectable: true, sale_selectable: true, },
      rules: [
        { id: "rl-pps1", label: "Stock → Packing", action: "pull", procure_method: "make_to_order", src_location_id: "loc-stock", dest_location_id: "loc-packing", picking_type_id: "op-pick", auto: "manual", data: { name: "Stock → Packing", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: true, delay: 0 }},
        { id: "rl-pps2", label: "Packing → Output", action: "pull", procure_method: "make_to_order", src_location_id: "loc-packing", dest_location_id: "loc-output", picking_type_id: "op-pack", auto: "manual", data: { name: "Packing → Output", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: true, delay: 0 }},
        { id: "rl-pps3", label: "Output → Customers", action: "pull", procure_method: "make_to_order", src_location_id: "loc-output", dest_location_id: "loc-customers", picking_type_id: "op-delivery", auto: "manual", data: { name: "Output → Customers", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: true, delay: 0 }},
      ]},
    // ── Production (with picking step)
    { id: "route-prod", label: "Manufacture (with picking)", colorIdx: 2,
      data: { name: "WH: Manufacture", active: true, product_selectable: true, product_categ_selectable: true, warehouse_selectable: false, sale_selectable: false, },
      rules: [
        { id: "rl-mo1", label: "Stock → Pre-Prod", action: "pull", procure_method: "make_to_order", src_location_id: "loc-stock", dest_location_id: "loc-preprod", picking_type_id: "op-mo-pick", auto: "manual", data: { name: "Stock → Pre-Production", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: false, delay: 0 }},
        { id: "rl-mo2", label: "Pre-Prod → Production", action: "manufacture", procure_method: "make_to_order", src_location_id: "loc-preprod", dest_location_id: "loc-production", picking_type_id: "op-mo-prod", auto: "manual", data: { name: "Manufacturing Order", action: "manufacture", procure_method: "make_to_order", auto: "manual", propagate_cancel: false, delay: 1 }},
        { id: "rl-mo3", label: "Production → Stock", action: "push", procure_method: "make_to_stock", src_location_id: "loc-production", dest_location_id: "loc-stock", picking_type_id: "op-mo-store", auto: "transparent", data: { name: "Post-Production → Stock", action: "push", procure_method: "make_to_stock", auto: "transparent", propagate_cancel: false, delay: 0 }},
      ]},
    // ── Crossdock
    { id: "route-xdock", label: "CrossDock", colorIdx: 3,
      data: { name: "WH: CrossDock", active: true, product_selectable: true, product_categ_selectable: false, warehouse_selectable: false, sale_selectable: true, },
      rules: [
        { id: "rl-xd1", label: "Input → CrossDock", action: "pull", procure_method: "make_to_order", src_location_id: "loc-input", dest_location_id: "loc-crossdock", picking_type_id: "op-crossdock", auto: "transparent", data: { name: "Input → CrossDock", action: "pull", procure_method: "make_to_order", auto: "transparent", propagate_cancel: true, delay: 0 }},
        { id: "rl-xd2", label: "CrossDock → Customers", action: "pull", procure_method: "make_to_order", src_location_id: "loc-crossdock", dest_location_id: "loc-customers", picking_type_id: "op-xd-out", auto: "manual", data: { name: "CrossDock → Customers", action: "pull", procure_method: "make_to_order", auto: "manual", propagate_cancel: true, delay: 0 }},
      ]},
    // ── Buy (simple replenishment)
    { id: "route-buy", label: "Buy", colorIdx: 4,
      data: { name: "WH: Buy", active: true, product_selectable: false, product_categ_selectable: false, warehouse_selectable: true, sale_selectable: false, },
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
  storageCategories: [
    { id: "cat-pallet", name: "Pallet",       allow_new_product: "same_product",   max_weight: 500, capacity_qty: 1   },
    { id: "cat-bin",    name: "Bin",          allow_new_product: "mixed_products", max_weight: 50,  capacity_qty: 100 },
    { id: "cat-cold",   name: "Cold Storage", allow_new_product: "mixed_products", max_weight: 0,   capacity_qty: 200 },
  ],
});

// ─── TEMPLATE BUILDERS ──────────────────────────────────────────────────────
const _wh = (id, label, x, y, code = "WH", extra = {}) => ({ id, type: "warehouse", label, x, y, data: { code, name: label, reception_steps: "one_step", delivery_steps: "ship_only", buy_to_resupply: true, manufacture_to_resupply: false, active: true, ...extra }});
const _ot = (id, label, code, src, dest, seq) => ({ id, label, code, sequence_code: seq, src_location_id: src, dest_location_id: dest, data: { name: label, code, sequence_code: seq, create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: code === "incoming", use_existing_lots: true, show_reserved: true }});
const _rule = (id, label, action, procure, src, dest, op, auto = "manual", delay = 0) => ({ id, label, action, procure_method: procure, src_location_id: src, dest_location_id: dest, picking_type_id: op, auto, data: { name: label, action, procure_method: procure, auto, propagate_cancel: false, delay }});
const _route = (id, label, colorIdx, rules, flags = {}) => ({ id, label, colorIdx, data: { name: label, active: true, product_selectable: false, product_categ_selectable: false, warehouse_selectable: true, sale_selectable: false, ...flags }, rules });

const buildBlank = () => ({
  nodes: [
    _wh("wh1", "Main Warehouse", 40, 10),
    L("loc-vendors", "Vendors", 40, 160, "supplier"),
    L("loc-stock", "WH/Stock", 360, 160, "internal", { barcode: "WH-STOCK" }),
    L("loc-customers", "Customers", 700, 160, "customer"),
  ],
  operationTypes: [], routes: [], putawayRules: [],
});

const buildReceive3 = () => ({
  nodes: [
    _wh("wh1", "Main Warehouse", 40, 10, "WH", { reception_steps: "three_steps" }),
    L("loc-vendors", "Vendors", 40, 160, "supplier"),
    L("loc-input", "WH/Input", 280, 160, "internal", { barcode: "WH-INPUT" }),
    L("loc-qc", "WH/Quality Control", 520, 160, "internal", { barcode: "WH-QC" }),
    L("loc-stock", "WH/Stock", 760, 160, "internal", { barcode: "WH-STOCK" }),
  ],
  operationTypes: [
    _ot("op-receipt", "Receipts", "incoming", "loc-vendors", "loc-input", "IN"),
    _ot("op-qc", "Quality Check", "internal", "loc-input", "loc-qc", "QC"),
    _ot("op-store", "Store", "internal", "loc-qc", "loc-stock", "STO"),
  ],
  routes: [
    _route("route-r3", "Receive 3 steps (Input→QC→Stock)", 0, [
      _rule("rl-1", "Vendors → Input", "pull", "make_to_order", "loc-vendors", "loc-input", "op-receipt"),
      _rule("rl-2", "Input → QC", "pull", "make_to_order", "loc-input", "loc-qc", "op-qc"),
      _rule("rl-3", "QC → Stock", "pull", "make_to_stock", "loc-qc", "loc-stock", "op-store"),
    ]),
  ],
  putawayRules: [],
});

const buildPPS = () => ({
  nodes: [
    _wh("wh1", "Main Warehouse", 40, 10, "WH", { delivery_steps: "pick_pack_ship" }),
    L("loc-stock", "WH/Stock", 40, 160, "internal", { barcode: "WH-STOCK" }),
    L("loc-pack", "WH/Packing", 280, 160, "internal", { barcode: "WH-PACK" }),
    L("loc-output", "WH/Output", 520, 160, "internal", { barcode: "WH-OUTPUT" }),
    L("loc-customers", "Customers", 760, 160, "customer"),
  ],
  operationTypes: [
    _ot("op-pick", "Pick", "internal", "loc-stock", "loc-pack", "PICK"),
    _ot("op-pack", "Pack", "internal", "loc-pack", "loc-output", "PACK"),
    _ot("op-deliv", "Delivery Orders", "outgoing", "loc-output", "loc-customers", "OUT"),
  ],
  routes: [
    _route("route-pps", "Pick → Pack → Ship", 1, [
      _rule("rl-1", "Stock → Packing", "pull", "make_to_order", "loc-stock", "loc-pack", "op-pick"),
      _rule("rl-2", "Packing → Output", "pull", "make_to_order", "loc-pack", "loc-output", "op-pack"),
      _rule("rl-3", "Output → Customers", "pull", "make_to_order", "loc-output", "loc-customers", "op-deliv"),
    ], { sale_selectable: true }),
  ],
  putawayRules: [],
});

const buildMTO = () => ({
  nodes: [
    _wh("wh1", "Main Warehouse", 40, 10),
    L("loc-stock", "WH/Stock", 40, 160, "internal", { barcode: "WH-STOCK" }),
    L("loc-customers", "Customers", 380, 160, "customer"),
  ],
  operationTypes: [_ot("op-deliv", "Delivery Orders", "outgoing", "loc-stock", "loc-customers", "OUT")],
  routes: [
    _route("route-mto", "Make to Order", 2, [
      _rule("rl-1", "Stock → Customers (MTO)", "pull", "make_to_order", "loc-stock", "loc-customers", "op-deliv"),
    ], { product_selectable: true, sale_selectable: true, warehouse_selectable: false }),
  ],
  putawayRules: [],
});

const buildBuy = () => ({
  nodes: [
    _wh("wh1", "Main Warehouse", 40, 10),
    L("loc-vendors", "Vendors", 40, 160, "supplier"),
    L("loc-stock", "WH/Stock", 380, 160, "internal", { barcode: "WH-STOCK" }),
  ],
  operationTypes: [_ot("op-receipt", "Receipts", "incoming", "loc-vendors", "loc-stock", "IN")],
  routes: [
    _route("route-buy", "Buy", 3, [
      _rule("rl-1", "Buy from Vendors", "buy", "make_to_order", "loc-vendors", "loc-stock", "op-receipt", "manual", 3),
    ]),
  ],
  putawayRules: [],
});

const buildMfg = () => ({
  nodes: [
    _wh("wh1", "Main Warehouse", 40, 10, "WH", { manufacture_to_resupply: true }),
    L("loc-stock", "WH/Stock", 40, 200, "internal", { barcode: "WH-STOCK" }),
    L("loc-preprod", "WH/Pre-Production", 280, 80, "internal", { barcode: "WH-PREPROD" }),
    L("loc-production", "Virtual/Production", 520, 200, "production"),
  ],
  operationTypes: [
    _ot("op-mo-pick", "MO Picking", "internal", "loc-stock", "loc-preprod", "PC"),
    _ot("op-mo-prod", "Manufacturing", "mrp_operation", "loc-preprod", "loc-production", "MO"),
    _ot("op-mo-store", "Post-Production", "internal", "loc-production", "loc-stock", "SFP"),
  ],
  routes: [
    _route("route-mfg", "Manufacture", 2, [
      _rule("rl-1", "Stock → Pre-Prod", "pull", "make_to_order", "loc-stock", "loc-preprod", "op-mo-pick"),
      _rule("rl-2", "Pre-Prod → Production", "manufacture", "make_to_order", "loc-preprod", "loc-production", "op-mo-prod", "manual", 1),
      _rule("rl-3", "Production → Stock", "push", "make_to_stock", "loc-production", "loc-stock", "op-mo-store", "transparent"),
    ], { product_selectable: true, product_categ_selectable: true }),
  ],
  putawayRules: [],
});

const buildXDock = () => ({
  nodes: [
    _wh("wh1", "Main Warehouse", 40, 10),
    L("loc-vendors", "Vendors", 40, 160, "supplier"),
    L("loc-input", "WH/Input", 280, 80, "internal", { barcode: "WH-INPUT" }),
    L("loc-xdock", "WH/CrossDock", 520, 160, "internal", { barcode: "WH-XDOCK" }),
    L("loc-customers", "Customers", 760, 160, "customer"),
  ],
  operationTypes: [
    _ot("op-receipt", "Receipts", "incoming", "loc-vendors", "loc-input", "IN"),
    _ot("op-xdock", "CrossDock", "internal", "loc-input", "loc-xdock", "XD"),
    _ot("op-deliv", "XD Ship", "outgoing", "loc-xdock", "loc-customers", "XDS"),
  ],
  routes: [
    _route("route-xd", "CrossDock", 3, [
      _rule("rl-1", "Input → CrossDock", "pull", "make_to_order", "loc-input", "loc-xdock", "op-xdock", "transparent"),
      _rule("rl-2", "CrossDock → Customers", "pull", "make_to_order", "loc-xdock", "loc-customers", "op-deliv"),
    ], { product_selectable: true, sale_selectable: true, warehouse_selectable: false }),
  ],
  putawayRules: [],
});

const TEMPLATES = [
  { id: "default",       name: "Full Demo Warehouse",   description: "Receive 3-step + PPS + Manufacture + Crossdock + Buy", icon: "⌂", build: () => initData() },
  { id: "blank",         name: "Blank",                 description: "Empty 1-warehouse canvas",                            icon: "▢", build: buildBlank },
  { id: "receive_3step", name: "Receive 3-step",        description: "Vendors → Input → QC → Stock",                        icon: "↘", build: buildReceive3 },
  { id: "delivery_pps",  name: "Pick → Pack → Ship",    description: "Classic 3-step delivery flow",                        icon: "↗", build: buildPPS },
  { id: "mto",           name: "Make to Order",         description: "Single MTO pull rule, no buffer stock",               icon: "↦", build: buildMTO },
  { id: "buy",           name: "Buy",                   description: "Buy route, vendors → stock direct",                   icon: "$", build: buildBuy },
  { id: "manufacture",   name: "Manufacture",           description: "MO with pre-prod and post-prod steps",                icon: "⚙", build: buildMfg },
  { id: "crossdock",     name: "Crossdock",             description: "Inbound forwarded directly to outbound",              icon: "⇄", build: buildXDock },
];

// ─── SEQUENCE BACKFILL ON IMPORT ─────────────────────────────────────────────
// Minimal sequence backfill on import. Fills missing/zero sequence on putaway
// rules and missing sequence_code on op-types. Brainstorm pending — see CLAUDE.md.
//
// TODO(brainstorm-needed): minimal sequence backfill added 2026-05-09.
// Open questions per CLAUDE.md: warehouse code autogen, route sequence,
// conflict resolution when prefixes collide (e.g. two ops with similar
// labels both → "QCH"). Pending Q&A pass with Brecht.
function backfillSequences(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  if (Array.isArray(out.putawayRules)) {
    out.putawayRules = out.putawayRules.map((pr, i) => ({
      ...pr,
      sequence: (pr.sequence && Number.isFinite(+pr.sequence) && +pr.sequence > 0) ? pr.sequence : (i + 1) * 10,
    }));
  }
  if (Array.isArray(out.operationTypes)) {
    out.operationTypes = out.operationTypes.map(o => {
      if (o.sequence_code && String(o.sequence_code).trim()) return o;
      const words = String(o.label || "").split(/\s+/).filter(Boolean);
      let prefix = "";
      if (words.length >= 2) prefix = words.slice(0, 3).map(w => w[0]).join("").toUpperCase();
      else if (words.length === 1) prefix = words[0].slice(0, 3).toUpperCase();
      else prefix = "OPN";
      // Pad to 3 chars (rare edge cases like single-letter labels)
      while (prefix.length < 3) prefix += "X";
      const finalPrefix = prefix.slice(0, 3);
      return {
        ...o,
        sequence_code: finalPrefix,
        data: { ...(o.data || {}), sequence_code: finalPrefix },
      };
    });
  }
  return out;
}

// ─── ROUTE OFFSET DETECTION (fan out overlapping/bidirectional edges) ────────
// Groups all rules by canonical node pair (sorted IDs) and assigns symmetric
// offsets so overlapping edges spread out and bidirectional pairs go on
// opposite sides of the node-pair line.
function buildEdgeOffsetMap(routes) {
  const SLOT = 30;
  // Group rules by canonical pair key
  const groups = new Map();
  for (const route of routes) {
    for (const rule of route.rules) {
      const [a, b] = [rule.src_location_id, rule.dest_location_id].sort();
      const key = `${a}\t${b}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id: rule.id, isCanonFwd: rule.src_location_id === a });
    }
  }
  // Assign bPath curveOffset for each rule.
  // bPath's perpendicular is +canonical_perp for forward edges and -canonical_perp for reverse.
  // To place edge at +k * canonical_perp: use curveOffset = isCanonFwd ? k : -k.
  const result = new Map();
  for (const [, edges] of groups) {
    const n = edges.length;
    edges.forEach((e, i) => {
      const desiredCanonOffset = n === 1 ? 0 : (i - (n - 1) / 2) * SLOT;
      result.set(e.id, e.isCanonFwd ? desiredCanonOffset : -desiredCanonOffset);
    });
  }
  return result;
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
          <div key={rule.id} style={{ padding: "6px 16px", borderBottom: `1px solid ${T.border}08` }}
            onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "82px 1fr", gap: 4, marginTop: 4, paddingLeft: 34 }}>
              <label style={{ fontSize: 9, color: T.textDim, alignSelf: "center", textTransform: "uppercase", letterSpacing: "0.5px" }}>Strategy</label>
              <select value={rule.storage_strategy || "manual_no_strategy"} onChange={e => onUpdate(rule.id, { storage_strategy: e.target.value })}
                style={{ background: T.surfaceRaised, border: `1px solid ${T.border}`, color: T.text, fontSize: 10, padding: "2px 4px", borderRadius: 3, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}>
                <option value="manual_no_strategy">Manual (no auto)</option>
                <option value="closest_location">Closest location</option>
                <option value="least_packages">Least packages</option>
              </select>
              <label style={{ fontSize: 9, color: T.textDim, alignSelf: "center", textTransform: "uppercase", letterSpacing: "0.5px" }}>Storage cat.</label>
              <input type="text" value={rule.storage_category_id || ""} placeholder="e.g. Pallet, Bin, Cold" onChange={e => onUpdate(rule.id, { storage_category_id: e.target.value })}
                style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.text, fontSize: 10, padding: "2px 6px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }} />
            </div>
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
const PropPanel = ({ sel, data, onUpdate, onClose, onDelete, onSaveToOdoo, hasOdooSession }) => {
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | { ok } | { error }
  if (!sel) return null;
  const { type, id, item } = sel;
  const fields = fieldDefs[type] || [];
  const s = nodeStyles[type] || nodeStyles.location;
  const handleSave = async () => {
    setSaveStatus("saving");
    const res = await onSaveToOdoo(type, id, item);
    if (res.error) { setSaveStatus({ error: res.error }); setTimeout(() => setSaveStatus(null), 4000); }
    else { setSaveStatus({ ok: true }); setTimeout(() => setSaveStatus(null), 2000); }
  };

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
          {hasOdooSession && (
            <Btn variant={saveStatus?.ok ? "default" : "primary"} small icon="upload" onClick={handleSave} disabled={saveStatus === "saving"}>
              {saveStatus === "saving" ? "…" : saveStatus?.ok ? "✓" : saveStatus?.error ? "✕" : "Save"}
            </Btn>
          )}
          <Btn variant="danger" small icon="delete" onClick={() => onDelete(type, id)} />
          <Btn variant="ghost" small icon="close" onClick={onClose} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {type !== "rule" && item?.label !== undefined && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Label</label>
            <input type="text" value={item.label} onChange={e => onUpdate(type, id, { label: e.target.value })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
          </div>
        )}
        {type === "operation_type" && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${T.border}` }}>Location Mapping</div>
            {["src_location_id", "dest_location_id"].map(k => (
              <div key={k} style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>{k === "src_location_id" ? "Source Location" : "Dest Location"}</label>
                <select value={item[k] || ""} onChange={e => onUpdate(type, id, { [k]: e.target.value })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }}>
                  {data.nodes.filter(n => n.type === "location").map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                </select>
              </div>
            ))}
          </>
        )}
        {type === "rule" && (() => {
          const op = data.operationTypes.find(o => o.id === item.picking_type_id);
          const isUmbrella = !!(op && (op.dest_location_id !== item.dest_location_id || op.src_location_id !== item.src_location_id));
          const labelOf = lid => data.nodes.find(n => n.id === lid)?.label || "—";
          return (
          <>
            {isUmbrella && (
              <div style={{ marginBottom: 12, padding: "8px 10px", background: T.amberSoft, border: `1px solid ${T.amber}55`, borderRadius: 5 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: T.amber, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>↳ Umbrella Rule</div>
                <div style={{ fontSize: 10, color: T.text, lineHeight: 1.5, fontFamily: "'IBM Plex Mono', monospace" }}>
                  Rule moves <b>{labelOf(item.src_location_id)} → {labelOf(item.dest_location_id)}</b><br/>
                  But the picking type <b>{op?.label}</b> only moves<br/>
                  <b>{labelOf(op.src_location_id)} → {labelOf(op.dest_location_id)}</b>.
                </div>
                <div style={{ fontSize: 9, color: T.textSoft, marginTop: 5, lineHeight: 1.4 }}>
                  This rule chains follow-up moves via downstream rules whose source matches its picking type's destination.
                </div>
              </div>
            )}
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${T.border}` }}>Connections</div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Label</label>
              <input type="text" value={item.label} onChange={e => onUpdate(type, id, { label: e.target.value })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            </div>
            {["src_location_id", "dest_location_id"].map(k => (
              <div key={k} style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>{k.includes("src") ? "Source" : "Destination"}</label>
                <select value={item[k]} onChange={e => onUpdate(type, id, { [k]: e.target.value })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }}>
                  {data.nodes.filter(n => n.type === "location").map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                </select>
              </div>
            ))}
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Operation Type</label>
              <select value={item.picking_type_id} onChange={e => onUpdate(type, id, { picking_type_id: e.target.value })} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }}>
                {data.operationTypes.map(op2 => <option key={op2.id} value={op2.id}>{op2.label}</option>)}
              </select>
            </div>
          </>
          );
        })()}
        <div style={{ fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${T.border}`, marginTop: 4 }}>Odoo Fields</div>
        {fields.map(f => {
          if (f.type === "group") {
            return (
              <div key={f.key} style={{ fontSize: 9, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.7px", margin: "12px 0 4px", paddingBottom: 2, borderBottom: `1px dashed ${T.border}` }}>{f.label}</div>
            );
          }
          const val = item.data?.[f.key];
          const setVal = v => onUpdate(type, id, { data: { ...item.data, [f.key]: v } });
          let input;
          if (f.type === "boolean") {
            input = (
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={!!val} onChange={e => setVal(e.target.checked)} style={{ accentColor: T.accent, width: 13, height: 13 }} />
                <span style={{ fontSize: 11, color: T.text }}>{val ? "Yes" : "No"}</span>
              </label>
            );
          } else if (f.type === "select") {
            input = (
              <select value={val ?? ""} onChange={e => setVal(e.target.value)} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}>
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            );
          } else if (f.type === "m2o") {
            let opts = f.source === "location" ? data.nodes.filter(n => n.type === "location")
              : f.source === "warehouse" ? data.nodes.filter(n => n.type === "warehouse")
              : f.source === "operation_type" ? data.operationTypes
              : f.source === "route" ? data.routes
              : f.source === "storage_category" ? (data.storageCategories || [])
              : [];
            // Self-reference safety: a location/warehouse/route can't be its own parent.
            opts = opts.filter(o => o.id !== id);
            // For location parent (location_id), sort view-type locations first
            // (canonical Odoo container), then everything else alphabetically.
            const isParentLocField = f.source === "location" && f.key === "location_id";
            if (isParentLocField) {
              opts = [...opts].sort((a, b) => {
                const av = a.data?.usage === "view" ? 0 : 1;
                const bv = b.data?.usage === "view" ? 0 : 1;
                return av - bv || (a.label || "").localeCompare(b.label || "");
              });
            }
            const labelOf = o => {
              if (f.source === "location") {
                const u = o.data?.usage || "internal";
                const tag = u === "view" ? "▢ view" : u;
                return `${o.label}  ·  ${tag}`;
              }
              return o.label;
            };
            input = (
              <select value={val ?? ""} onChange={e => setVal(e.target.value)} style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }}>
                <option value="">—</option>
                {opts.map(o => <option key={o.id} value={o.id}>{labelOf(o)}</option>)}
              </select>
            );
          } else if (f.type === "m2m") {
            const arr = Array.isArray(val) ? val : (typeof val === "string" && val ? val.split(",").map(x => x.trim()).filter(Boolean) : []);
            const localOpts = f.source === "warehouse" ? data.nodes.filter(n => n.type === "warehouse")
              : f.source === "location" ? data.nodes.filter(n => n.type === "location")
              : null;
            input = (
              <input type="text" value={arr.join(", ")} placeholder={f.hint || "comma-separated"} onChange={e => setVal(e.target.value.split(",").map(x => x.trim()).filter(Boolean))}
                list={localOpts ? `m2m-${type}-${f.key}` : undefined}
                style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }} />
            );
            if (localOpts) {
              input = (
                <>
                  {input}
                  <datalist id={`m2m-${type}-${f.key}`}>{localOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</datalist>
                </>
              );
            }
          } else if (f.type === "ref") {
            input = (
              <input type="text" value={val ?? ""} placeholder={f.hint || ""} onChange={e => setVal(e.target.value)}
                style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }} />
            );
          } else if (f.type === "domain_helper") {
            const presetBtnStyle = { padding: "3px 8px", borderRadius: 4, border: `1px solid ${T.border}`, background: "transparent", color: T.textDim, fontSize: 10, fontFamily: "inherit", cursor: "pointer" };
            const insertPreset = expr => {
              const current = (val || "").trim();
              const next = current ? `${current}, ${expr}` : expr;
              setVal(next);
            };
            const wrapInBrackets = () => {
              const c = (val || "").trim();
              if (!c) return;
              const wrapped = c.startsWith("[") ? c : `[${c}]`;
              setVal(wrapped);
            };
            input = (
              <div>
                <textarea value={val || ""} onChange={e => setVal(e.target.value)}
                  placeholder="[('field','operator','value')]"
                  rows={3}
                  style={{ width: "100%", background: T.surfaceRaised, border: `1px solid ${T.border}`, color: T.text, fontSize: 11, padding: 6, borderRadius: 4, fontFamily: "'IBM Plex Mono', monospace", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
                <div style={{ marginTop: 6 }}>
                  {DOMAIN_PRESETS.map((group, gi) => (
                    <details key={group.category} open={gi === 0} style={{ marginBottom: 4 }}>
                      <summary style={{ fontSize: 10, color: T.textDim, cursor: "pointer", padding: "2px 0", userSelect: "none" }}>
                        {group.category} <span style={{ color: T.textDim, opacity: 0.6 }}>({group.presets.length})</span>
                      </summary>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingLeft: 8, paddingTop: 4 }}>
                        {group.presets.map(p => (
                          <button key={p.label} type="button" title={p.description}
                            onClick={() => insertPreset(p.expression)}
                            style={presetBtnStyle}>+ {p.label}</button>
                        ))}
                      </div>
                    </details>
                  ))}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                    <button type="button" title="Wrap the textarea content in [...] to form a valid Odoo domain list"
                      onClick={wrapInBrackets}
                      style={{ ...presetBtnStyle, color: T.accent, borderColor: T.accent + "55" }}>Wrap in [...]</button>
                  </div>
                </div>
                <div style={{ marginTop: 4, fontSize: 9, color: T.textDim, lineHeight: 1.4 }}>
                  Push-rule domain. Odoo evaluates this against the moving product. Multiple conditions: AND-joined.
                </div>
              </div>
            );
          } else {
            input = (
              <input type={f.type === "number" ? "number" : "text"} value={val ?? ""} onChange={e => setVal(f.type === "number" ? (parseFloat(e.target.value) || 0) : e.target.value)}
                style={{ width: "100%", padding: "6px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 12, fontFamily: f.type === "number" ? "'IBM Plex Mono', monospace" : "inherit", outline: "none", boxSizing: "border-box" }} />
            );
          }
          return (
            <div key={f.key} style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 3 }}>
                {f.label}
                {f.hint && f.type === "ref" && <span style={{ color: T.textDim, fontWeight: 500, textTransform: "none", letterSpacing: 0, marginLeft: 4 }}>· {f.hint}</span>}
              </label>
              {input}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── API PANEL ──────────────────────────────────────────────────────────────
const ApiPanel = ({ data, apiConfig, onClose }) => {
  const [tab, setTab] = useState("fetch");
  const u = apiConfig.url || "https://your-odoo.com", db = apiConfig.db || "your_db", l = apiConfig.username || "admin";
  const fetchCode = `import xmlrpc.client\n\nurl = "${u}"\ndb = "${db}"\nusername = "${l}"\napi_key = "YOUR_API_KEY"  # Settings → Users → API Keys\n\ncommon = xmlrpc.client.ServerProxy(f"{u}/xmlrpc/2/common")\nuid = common.authenticate(db, username, api_key, {})\nmodels = xmlrpc.client.ServerProxy(f"{u}/xmlrpc/2/object")\n\ndef sr(model, domain=[], fields=[], limit=100):\n    return models.execute_kw(db, uid, api_key, model, 'search_read', [domain], {'fields': fields, 'limit': limit})\n\nwarehouses = sr('stock.warehouse', [], ['name','code','reception_steps','delivery_steps'])\nlocations = sr('stock.location', [('usage','!=','view')], ['complete_name','usage','removal_strategy','barcode','storage_category_id'])\npicking_types = sr('stock.picking.type', [], ['name','code','sequence_code','default_location_src_id','default_location_dest_id','create_backorder','reservation_method'])\nroutes = sr('stock.route', [], ['name','active','rule_ids','product_selectable','warehouse_selectable','sale_selectable'])\n\nfor route in routes:\n    if route.get('rule_ids'):\n        rules = sr('stock.rule', [('id','in',route['rule_ids'])], ['name','action','procure_method','location_src_id','location_dest_id','picking_type_id','auto','delay'])\n        for r in rules:\n            src = r.get('location_src_id',[0,''])[1] if isinstance(r.get('location_src_id'),(list,tuple)) else ''\n            dst = r.get('location_dest_id',[0,''])[1] if isinstance(r.get('location_dest_id'),(list,tuple)) else ''\n            print(f"  [{r['action']}] {src} → {dst}")\n\nputaway = sr('stock.putaway.rule', [], ['product_id','category_id','location_in_id','location_out_id','sequence','storage_category_id','storage_strategy'])\nprint(f"\\nTotal: {len(warehouses)} WH, {len(locations)} loc, {len(picking_types)} ops, {len(routes)} routes, {len(putaway)} putaway")`;
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
const CfgModal = ({ cfg, onChange, onClose }) => {
  const [testStatus, setTestStatus] = useState(null); // null | "testing" | { ok: string } | { error: string }
  const handleTest = async () => {
    if (!cfg.url || !cfg.db || !cfg.username || !cfg.apiKey) { setTestStatus({ error: "Fill in all fields first" }); return; }
    setTestStatus("testing");
    try {
      const session = await odooRpc(cfg, "/web/session/authenticate", { db: cfg.db, login: cfg.username, password: cfg.apiKey });
      if (!session?.uid) throw new Error("Authentication failed");
      setTestStatus({ ok: `Connected as uid ${session.uid}` });
    } catch (err) {
      setTestStatus({ error: err.message || "Connection failed" });
    }
  };
  return (
  <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
    <div style={{ width: 400, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Odoo Connection</span>
        <Btn variant="ghost" small icon="close" onClick={onClose} />
      </div>
      <div style={{ padding: "14px 18px" }}>
        {[{ k: "url", l: "Server URL", p: "https://mycompany.odoo.com" }, { k: "db", l: "Database", p: "mycompany-main" }, { k: "username", l: "Login", p: "admin@company.com" }, { k: "apiKey", l: "API Key", p: "Settings → Users → API Keys", t: "password" }].map(f => (
          <div key={f.k} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>{f.l}</label>
            <input type={f.t || "text"} value={cfg[f.k] || ""} placeholder={f.p} onChange={e => onChange({ ...cfg, [f.k]: e.target.value })} style={{ width: "100%", padding: "7px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }} />
          </div>
        ))}
        {testStatus && testStatus !== "testing" && (
          <div style={{ padding: "6px 10px", marginBottom: 8, borderRadius: 5, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", background: testStatus.ok ? T.greenSoft : T.roseSoft, color: testStatus.ok ? T.green : T.rose }}>
            {testStatus.ok || testStatus.error}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon="api" onClick={handleTest} disabled={testStatus === "testing"}>{testStatus === "testing" ? "Testing…" : "Test"}</Btn>
        </div>
      </div>
    </div>
  </div>
  );
};

// ─── SHRINK DIALOG (Plan B) ─────────────────────────────────────────────
// Shown when an edit on a wizard-managed warehouse flag would orphan
// existing __autoGen-tagged entities. Three resolutions: cancel, delete
// the orphans, or keep them but mark them inactive.
const ShrinkDialog = ({ diff, warehouse, fieldLabel, oldValue, newValue, onCancel, onDelete, onDeactivate }) => {
  const orphanCount = diff.toRemove.nodeIds.length + diff.toRemove.opTypeIds.length + diff.toRemove.routeIds.length;
  const hasExternalRefs = diff.externalRefs.length > 0;
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onCancel}>
      <div style={{ width: 540, maxHeight: "85vh", background: T.surface, border: `1px solid ${T.amber}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, background: T.amberSoft, color: T.amber, fontSize: 13, fontWeight: 700 }}>
          ⚠ Reducing {fieldLabel} {String(oldValue)} → {String(newValue)} on {warehouse.label}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16, fontSize: 11, color: T.text }}>
          <div style={{ marginBottom: 10 }}>This will orphan {orphanCount} entit{orphanCount === 1 ? 'y' : 'ies'}:</div>
          {diff.toRemove.nodeIds.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: T.textDim, marginBottom: 2 }}>Locations:</div>
              <div style={{ paddingLeft: 12, color: T.text, fontFamily: "'IBM Plex Mono', monospace" }}>{diff.toRemove.nodeIds.join(', ')}</div>
            </div>
          )}
          {diff.toRemove.opTypeIds.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: T.textDim, marginBottom: 2 }}>Operation types:</div>
              <div style={{ paddingLeft: 12, color: T.text, fontFamily: "'IBM Plex Mono', monospace" }}>{diff.toRemove.opTypeIds.join(', ')}</div>
            </div>
          )}
          {diff.toRemove.routeIds.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: T.textDim, marginBottom: 2 }}>Routes ({diff.toRemove.ruleIds.length} rules):</div>
              <div style={{ paddingLeft: 12, color: T.text, fontFamily: "'IBM Plex Mono', monospace" }}>{diff.toRemove.routeIds.join(', ')}</div>
            </div>
          )}
          {diff.toRemove.putawayRuleIds.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: T.textDim, marginBottom: 2 }}>Putaway rules:</div>
              <div style={{ paddingLeft: 12, color: T.text }}>{diff.toRemove.putawayRuleIds.length}</div>
            </div>
          )}
          {hasExternalRefs && (
            <div style={{ marginTop: 12, padding: 10, background: T.amberSoft, borderRadius: 4, border: `1px solid ${T.amber}` }}>
              <div style={{ color: T.amber, fontWeight: 700, marginBottom: 6 }}>⚠ External references at risk:</div>
              {diff.externalRefs.map((er, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div style={{ color: T.text }}>{er.orphanLabel}:</div>
                  {er.referencedBy.map((ref, j) => (
                    <div key={j} style={{ paddingLeft: 12, color: T.textDim, fontSize: 10 }}>
                      {ref.kind} {ref.label}{ref.routeLabel ? ` (in ${ref.routeLabel})` : ''}
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ marginTop: 6, fontSize: 10, color: T.textDim }}>
                Choosing Delete will leave these references dangling (visual error in the canvas).
                Choose Deactivate to keep them resolvable.
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" small onClick={onCancel}>Cancel</Btn>
          <Btn variant="ghost" small onClick={onDeactivate}>Keep but deactivate</Btn>
          <Btn variant="primary" small onClick={onDelete}>Delete orphans</Btn>
        </div>
      </div>
    </div>
  );
};

// ─── WAREHOUSE PRESET WIZARD ────────────────────────────────────────────
const WizardModal = ({ existingNodes, onClose, onSkip, onCreate }) => {
  const ordinals = ['Main', 'Secondary', 'Tertiary', 'Quaternary', 'Quinary'];
  const existingWarehouses = existingNodes.filter(n => n.type === 'warehouse');
  const wCount = existingWarehouses.length;
  const defaultCode = wCount === 0 ? 'WH' : `WH${wCount + 1}`;
  const defaultName = wCount < ordinals.length
    ? `${ordinals[wCount]} Warehouse`
    : `Warehouse ${wCount + 1}`;

  const [code, setCode] = useState(defaultCode);
  const [name, setName] = useState(defaultName);
  const [flags, setFlags] = useState({
    reception_steps: 'one_step',
    delivery_steps:  'ship_only',
    manufacture_to_resupply: false,
    manufacture_steps: 'mrp_one_step',
    buy_to_resupply: true,
    resupply_wh_ids: [],
  });

  const preview = useMemo(() => {
    const ephemeralId = `wh-${Math.random().toString(36).slice(2, 8)}`;
    return presetGenerator({
      warehouseId: ephemeralId, warehouseCode: code, warehouseName: name,
      flags, existingNodes,
    });
  }, [code, name, flags, existingNodes]);

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
      <div style={{ width: 720, maxHeight: "85vh", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>New warehouse</span>
          <Btn variant="ghost" small icon="close" onClick={onClose} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 8, fontWeight: 600 }}>Identity</div>
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 8, marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: T.textDim, alignSelf: "center" }}>Code</label>
              <input value={code} onChange={e => setCode(e.target.value)}
                style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }}
                maxLength={5} />
              <label style={{ fontSize: 11, color: T.textDim, alignSelf: "center" }}>Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }} />
            </div>

            <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 8, fontWeight: 600 }}>Routings</div>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: T.textDim, alignSelf: "center" }}>Reception</label>
              <select value={flags.reception_steps} onChange={e => setFlags(f => ({ ...f, reception_steps: e.target.value }))}
                style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }}>
                <option value="one_step">Receive directly (1 step)</option>
                <option value="two_steps">Input → Stock (2 steps)</option>
                <option value="three_steps">Input → QC → Stock (3 steps)</option>
              </select>
              <label style={{ fontSize: 11, color: T.textDim, alignSelf: "center" }}>Delivery</label>
              <select value={flags.delivery_steps} onChange={e => setFlags(f => ({ ...f, delivery_steps: e.target.value }))}
                style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }}>
                <option value="ship_only">Deliver directly (1 step)</option>
                <option value="pick_ship">Pick → Ship (2 steps)</option>
                <option value="pick_pack_ship">Pick → Pack → Ship (3 steps)</option>
              </select>
            </div>

            <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 8, fontWeight: 600 }}>Resupply</div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, marginBottom: 8 }}>
              <input type="checkbox" checked={flags.buy_to_resupply}
                onChange={e => setFlags(f => ({ ...f, buy_to_resupply: e.target.checked }))} />
              Buy to resupply
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, marginBottom: 8 }}>
              <input type="checkbox" checked={flags.manufacture_to_resupply}
                onChange={e => setFlags(f => ({ ...f, manufacture_to_resupply: e.target.checked }))} />
              Manufacture to resupply
            </label>
            {flags.manufacture_to_resupply && (
              <div style={{ marginLeft: 22, marginBottom: 8 }}>
                <select value={flags.manufacture_steps}
                  onChange={e => setFlags(f => ({ ...f, manufacture_steps: e.target.value }))}
                  style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }}>
                  <option value="mrp_one_step">Manufacture (1 step)</option>
                  <option value="pbm">Pick + Manufacture (2 steps)</option>
                  <option value="pbm_sam">Pick + Manufacture + Store (3 steps)</option>
                </select>
              </div>
            )}

            {existingWarehouses.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <label style={{ fontSize: 11, color: T.textDim, marginBottom: 6, display: "block" }}>
                  Resupply from
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {existingWarehouses.map(wh => {
                    const selected = flags.resupply_wh_ids.includes(wh.id);
                    return (
                      <button key={wh.id} type="button"
                        onClick={() => setFlags(f => ({
                          ...f,
                          resupply_wh_ids: selected
                            ? f.resupply_wh_ids.filter(id => id !== wh.id)
                            : [...f.resupply_wh_ids, wh.id],
                        }))}
                        style={{
                          padding: "4px 10px", borderRadius: 12, border: `1px solid ${T.border}`,
                          background: selected ? T.accentSoft : "transparent",
                          color: selected ? T.accent : T.textDim,
                          fontSize: 11, fontFamily: "inherit", cursor: "pointer",
                        }}>
                        {selected ? "✓ " : ""}{wh.data?.code || wh.label} ({wh.label})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div style={{ background: T.surfaceHover, borderRadius: 6, padding: 12, fontSize: 11, color: T.text, overflow: "auto" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Will create:</div>

            <div style={{ marginBottom: 6, color: T.textDim }}>Locations ({preview.addNodes.filter(n => n.type === "location").length})</div>
            {preview.addNodes.filter(n => n.type === "location").map(n => (
              <div key={n.id} style={{ paddingLeft: 8, color: T.text, marginBottom: 2 }}>{n.label} <span style={{ color: T.textDim }}>({n.data.usage})</span></div>
            ))}

            <div style={{ marginTop: 10, marginBottom: 6, color: T.textDim }}>Operation types ({preview.addOperationTypes.length})</div>
            {preview.addOperationTypes.map(o => (
              <div key={o.id} style={{ paddingLeft: 8, color: T.text, marginBottom: 2 }}>{o.label} <span style={{ color: T.textDim }}>({o.code})</span></div>
            ))}

            <div style={{ marginTop: 10, marginBottom: 6, color: T.textDim }}>Routes ({preview.addRoutes.length})</div>
            {preview.addRoutes.map(r => (
              <div key={r.id} style={{ paddingLeft: 8, color: T.text, marginBottom: 2 }}>{r.label} <span style={{ color: T.textDim }}>({r.rules.length} rules)</span></div>
            ))}

            {preview.addNodes.length === 0 && preview.addOperationTypes.length === 0 && preview.addRoutes.length === 0 && (
              <div style={{ color: T.textDim, fontStyle: "italic" }}>(empty — toggle some options)</div>
            )}
          </div>
        </div>
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={onSkip} style={{ background: "none", border: "none", color: T.accent, fontSize: 11, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0 }}>
            Skip — just add empty WH
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" small onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" small onClick={() => {
              if (!code.trim() || !name.trim()) return;
              const warehouseId = `wh-${Math.random().toString(36).slice(2, 8)}`;
              const codeTaken = existingNodes.some(n => n.type === 'warehouse' && (n.data?.code || '').toUpperCase() === code.trim().toUpperCase());
              if (codeTaken) { alert(`Warehouse code "${code}" already in use`); return; }
              onCreate({
                warehouseId, warehouseCode: code.trim(), warehouseName: name.trim(),
                flags, existingNodes,
              });
            }}>Create</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── ADD MODAL ──────────────────────────────────────────────────────────────
const AddModal = ({ onAdd, routes, onAddRule, onApplyTemplate, onClose }) => {
  const [ruleTarget, setRuleTarget] = useState(null);
  const [tplMode, setTplMode] = useState(false);

  if (tplMode) {
    return (
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
        <div style={{ width: 460, maxHeight: "82vh", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setTplMode(false)} style={{ background: "none", border: "none", cursor: "pointer", color: T.textSoft, fontSize: 14, fontFamily: "inherit", padding: 0 }}>←</button>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Apply Template</span>
            </div>
            <Btn variant="ghost" small icon="close" onClick={onClose} />
          </div>
          <div style={{ padding: "8px 12px 6px", fontSize: 10, color: T.amber, background: T.amberSoft, borderBottom: `1px solid ${T.border}`, lineHeight: 1.4 }}>
            ⚠ "Replace" overwrites the current diagram (export first to keep it). "+ Add" merges into the current canvas with id-remapping.
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
            {TEMPLATES.map(tpl => (
              <div key={tpl.id}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", background: "transparent", borderRadius: 5, fontFamily: "inherit" }}
                onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ width: 32, height: 32, borderRadius: 5, background: T.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: T.accent, flexShrink: 0 }}>{tpl.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{tpl.name}</div>
                  <div style={{ fontSize: 10, color: T.textSoft }}>{tpl.description}</div>
                </div>
                <button
                  onClick={() => { if (confirm(`Replace current diagram with "${tpl.name}"?`)) { onApplyTemplate(tpl, "replace"); onClose(); } }}
                  title="Overwrite the current diagram with this template"
                  style={{ padding: "4px 8px", fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: T.amber, background: T.amberSoft, border: `1px solid ${T.amber}`, borderRadius: 4, cursor: "pointer", flexShrink: 0 }}>
                  Replace
                </button>
                <button
                  onClick={() => { onApplyTemplate(tpl, "append"); onClose(); }}
                  title="Merge this template into the current canvas (ids remapped)"
                  style={{ padding: "4px 8px", fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: T.accent, background: T.accentSoft, border: `1px solid ${T.accent}`, borderRadius: 4, cursor: "pointer", flexShrink: 0 }}>
                  + Add
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

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
          <div style={{ height: 1, background: T.border, margin: "6px 10px" }} />
          <div style={{ padding: "2px 10px 4px", fontSize: 8, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.6px" }}>Start Fresh</div>
          <button onClick={() => setTplMode(true)} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "9px 10px", background: "transparent", border: "none", borderRadius: 5, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
            onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ width: 30, height: 30, borderRadius: 5, background: T.greenSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>📋</div>
            <div><div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>From Template</div><div style={{ fontSize: 9, color: T.textSoft }}>{TEMPLATES.length} starter templates</div></div>
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── PUSH CONFIRMATION MODAL ────────────────────────────────────────────────
const PushModal = ({ changes, onConfirm, onCancel }) => {
  const grouped = { creates: {}, updates: {}, deletes: {} };
  for (const c of changes.creates) { grouped.creates[c.type] = (grouped.creates[c.type] || 0) + 1; }
  for (const c of changes.updates) { grouped.updates[c.type] = (grouped.updates[c.type] || 0) + 1; }
  for (const c of changes.deletes) { grouped.deletes[c.type] = (grouped.deletes[c.type] || 0) + 1; }
  const Section = ({ label, items, color }) => {
    const entries = Object.entries(items);
    if (entries.length === 0) return null;
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
        {entries.map(([type, count]) => (
          <div key={type} style={{ fontSize: 11, color: T.text, padding: "2px 0", fontFamily: "'IBM Plex Mono', monospace" }}>
            {count}× {type.replace(/_/g, " ")}
          </div>
        ))}
      </div>
    );
  };
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onCancel}>
      <div style={{ width: 380, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Push to Odoo</span>
          <Btn variant="ghost" small icon="close" onClick={onCancel} />
        </div>
        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 12 }}>{changes.total} change{changes.total !== 1 ? "s" : ""} to push:</div>
          <Section label="Create" items={grouped.creates} color={T.green} />
          <Section label="Update" items={grouped.updates} color={T.amber} />
          <Section label="Deactivate" items={grouped.deletes} color={T.rose} />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 12 }}>
            <Btn onClick={onCancel}>Cancel</Btn>
            <Btn variant="primary" icon="upload" onClick={() => onConfirm(changes)}>Push {changes.total} changes</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// ODOO LIVE FETCH & WRITE
// ═════════════════════════════════════════════════════════════════════════════

// Konu-mode bootstrap: when the visualiser is served by the konu_tools Odoo
// module, the controller injects `window.__KONU_CFG__` with the connection
// id. RPCs then go through /konu_tools/rpc/<id> on Konu's Odoo, which adds
// the customer's API key server-side. No credentials prompt, no proxy server.
const KONU_CFG = (typeof window !== "undefined" && window.__KONU_CFG__) || null;

// Low-level proxy call. Sends { targetUrl, path, params } to /odoo-proxy and
// returns result, or throws with a human-readable message.
async function odooRpc(cfg, path, params) {
  // Konu mode: route via in-Odoo controller
  if (KONU_CFG && KONU_CFG.konuMode) {
    const url = `/konu_tools/rpc/${KONU_CFG.connectionId}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { path, params } }),
    });
    const wrap = await res.json();
    // Odoo type=json wraps response under { result: {...} }
    const inner = wrap?.result || wrap;
    if (inner?.error) {
      const msg = inner.error?.message || JSON.stringify(inner.error);
      throw new Error(msg);
    }
    return inner?.result !== undefined ? inner.result : inner;
  }
  // Standalone mode: original proxy server flow
  if (window.location.protocol === "file:") {
    throw new Error("Live Odoo calls require the proxy server.\nRun: npm run proxy  then open http://localhost:4173");
  }
  const res = await fetch("/odoo-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUrl: cfg.url, path, params }),
  });
  const json = await res.json();
  if (json?.error) {
    const msg = json.error?.data?.message || json.error?.message || JSON.stringify(json.error);
    throw new Error(msg);
  }
  return json.result;
}

// Extract Odoo numeric ID from app ID (e.g. "loc-42" → 42, "route-1743600000000" → null for local items)
function odooId(appId) {
  const m = appId?.match(/-(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1]);
  return n < 1e10 ? n : null; // timestamp IDs (>10 digits) are local
}

// Model name for each app entity type
const ODOO_MODEL = {
  warehouse: "stock.warehouse", location: "stock.location",
  operation_type: "stock.picking.type", route: "stock.route",
  rule: "stock.rule", putaway_rule: "stock.putaway.rule",
};

// Write a single record to Odoo
async function odooWrite(cfg, ctx, model, id, vals) {
  return odooRpc(cfg, "/web/dataset/call_kw", {
    model, method: "write", args: [[id], vals], kwargs: { context: ctx },
  });
}

// Create a single record in Odoo, returns new ID
async function odooCreate(cfg, ctx, model, vals) {
  return odooRpc(cfg, "/web/dataset/call_kw", {
    model, method: "create", args: [vals], kwargs: { context: ctx },
  });
}

// Deactivate a record (soft delete)
async function odooDeactivate(cfg, ctx, model, id) {
  return odooRpc(cfg, "/web/dataset/call_kw", {
    model, method: "write", args: [[id], { active: false }], kwargs: { context: ctx },
  });
}

// Deep-compare two plain objects, return object with only changed keys (or null if equal)
function diffData(current, previous) {
  if (!current || !previous) return current || null;
  const changes = {};
  let hasChanges = false;
  for (const key of Object.keys(current)) {
    if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
      changes[key] = current[key];
      hasChanges = true;
    }
  }
  return hasChanges ? changes : null;
}

// Build app→Odoo field values for writing. Converts app IDs to Odoo IDs.
function toOdooVals(type, item) {
  const vals = { ...item.data };
  if (type === "operation_type") {
    if (item.src_location_id) vals.default_location_src_id = odooId(item.src_location_id);
    if (item.dest_location_id) vals.default_location_dest_id = odooId(item.dest_location_id);
  }
  if (type === "rule") {
    if (item.src_location_id) vals.location_src_id = odooId(item.src_location_id);
    if (item.dest_location_id) vals.location_dest_id = odooId(item.dest_location_id);
    if (item.picking_type_id) vals.picking_type_id = odooId(item.picking_type_id);
  }
  // Remove fields that are display-only or not writable
  delete vals.complete_name;
  return vals;
}

// Compute all changes between current data and the fetched snapshot
function computeChanges(current, snapshot) {
  if (!snapshot) return { creates: [], updates: [], deletes: [], total: 0 };
  const creates = [], updates = [], deletes = [];

  // Helper: compare lists by ID
  const diffList = (curItems, snapItems, type) => {
    const snapMap = new Map(snapItems.map(i => [i.id, i]));
    const curMap = new Map(curItems.map(i => [i.id, i]));
    for (const item of curItems) {
      const oid = odooId(item.id);
      if (!oid) { creates.push({ type, item }); continue; }
      const prev = snapMap.get(item.id);
      if (!prev) { creates.push({ type, item }); continue; }
      const changed = diffData(item.data, prev.data);
      // Also check connection fields for ops/rules
      let connChanged = false;
      if (type === "operation_type") {
        connChanged = item.src_location_id !== prev.src_location_id || item.dest_location_id !== prev.dest_location_id;
      }
      if (type === "rule") {
        connChanged = item.src_location_id !== prev.src_location_id || item.dest_location_id !== prev.dest_location_id || item.picking_type_id !== prev.picking_type_id;
      }
      if (changed || connChanged || item.label !== prev.label) {
        updates.push({ type, item, oid, changed });
      }
    }
    for (const item of snapItems) {
      if (!curMap.has(item.id) && odooId(item.id)) {
        deletes.push({ type, item, oid: odooId(item.id) });
      }
    }
  };

  diffList(current.nodes, snapshot.nodes, current.nodes[0]?.type || "location");
  // Fix: diff nodes by type
  const curWh = current.nodes.filter(n => n.type === "warehouse");
  const snapWh = snapshot.nodes.filter(n => n.type === "warehouse");
  const curLoc = current.nodes.filter(n => n.type === "location");
  const snapLoc = snapshot.nodes.filter(n => n.type === "location");
  // Reset and redo properly
  creates.length = 0; updates.length = 0; deletes.length = 0;
  diffList(curWh, snapWh, "warehouse");
  diffList(curLoc, snapLoc, "location");
  diffList(current.operationTypes, snapshot.operationTypes, "operation_type");

  // Flatten rules from routes
  const flatRules = (routes) => {
    const rules = [];
    for (const r of routes) for (const rl of r.rules) rules.push({ ...rl, _routeId: r.id });
    return rules;
  };
  diffList(current.routes, snapshot.routes, "route");
  diffList(flatRules(current.routes), flatRules(snapshot.routes), "rule");
  diffList(current.putawayRules, snapshot.putawayRules, "putaway_rule");

  return { creates, updates, deletes, total: creates.length + updates.length + deletes.length };
}

// Authenticate and pull the full inventory config, returning an app-ready data object.
async function fetchInventoryFromOdoo(cfg, onProgress = () => {}) {
  // 1. Authenticate via session (api key used as password)
  const session = await odooRpc(cfg, "/web/session/authenticate", {
    db: cfg.db, login: cfg.username, password: cfg.apiKey,
  });
  if (!session?.uid) throw new Error("Authentication failed — check URL, database, username and API key.");

  // 2. search_read helper (single batch)
  const sr = (model, domain, fields, limit = 500) =>
    odooRpc(cfg, "/web/dataset/call_kw", {
      model, method: "search_read",
      args: [domain], kwargs: { fields, limit, context: session.user_context || {} },
    });

  // 2b. Paginated fetch for large models
  const fetchAll = async (model, domain, fields, batchSize = 500, onProgress) => {
    let off = 0, results = [];
    while (true) {
      const batch = await odooRpc(cfg, "/web/dataset/call_kw", {
        model, method: "search_read",
        args: [domain], kwargs: { fields, limit: batchSize, offset: off, context: session.user_context || {} },
      });
      results.push(...batch);
      if (onProgress) onProgress(results.length);
      if (batch.length < batchSize) break;
      off += batchSize;
    }
    return results;
  };

  // 3. Fetch all models (locations and rules paged; others are bounded)
  onProgress("Fetching warehouses, routes & operations…");
  const [warehouses, pickingTypes, routes, putaway] = await Promise.all([
    sr("stock.warehouse", [], ["name","code","reception_steps","delivery_steps","buy_to_resupply","manufacture_to_resupply"]),
    sr("stock.picking.type", [["active","=",true]], ["name","code","sequence_code","default_location_src_id","default_location_dest_id","create_backorder","reservation_method","use_create_lots","use_existing_lots","show_reserved"]),
    sr("stock.route", [["active","=",true]], ["name","active","product_selectable","product_categ_selectable","warehouse_selectable","sale_selectable","rule_ids"]),
    sr("stock.putaway.rule", [], ["product_id","category_id","location_in_id","location_out_id","sequence","storage_category_id","storage_strategy"]),
  ]);
  onProgress("Fetching locations…");
  const locations = await fetchAll("stock.location", [["usage","!=","view"],["active","=",true]], ["complete_name","usage","removal_strategy_id","barcode","scrap_location","replenish_location","storage_category_id"], 500, n => onProgress(`Fetching locations… (${n})`));
  onProgress("Fetching rules…");
  const rules = await fetchAll("stock.rule", [["active","=",true]], ["name","action","procure_method","location_src_id","location_dest_id","picking_type_id","auto","delay","propagate_cancel","route_id"], 500, n => onProgress(`Fetching rules… (${n})`));

  // 4. ID → app-id lookup maps
  const rid = (field) => Array.isArray(field) ? field[0] : field; // unwrap many2one [id, name]
  const rname = (field) => Array.isArray(field) ? field[1] : "";
  let locMap = new Map(locations.map(l => [l.id, `loc-${l.id}`]));
  const opMap  = new Map(pickingTypes.map(p => [p.id, `op-${p.id}`]));

  // 4b. Find location IDs referenced by rules/ops but missing from fetched locations
  const referencedLocIds = new Set();
  for (const rule of rules) {
    const src = rid(rule.location_src_id); if (src && !locMap.has(src)) referencedLocIds.add(src);
    const dst = rid(rule.location_dest_id); if (dst && !locMap.has(dst)) referencedLocIds.add(dst);
  }
  for (const pt of pickingTypes) {
    const src = rid(pt.default_location_src_id); if (src && !locMap.has(src)) referencedLocIds.add(src);
    const dst = rid(pt.default_location_dest_id); if (dst && !locMap.has(dst)) referencedLocIds.add(dst);
  }
  if (referencedLocIds.size > 0) {
    onProgress(`Fetching ${referencedLocIds.size} missing locations…`);
    const missingLocs = await sr("stock.location", [["id","in",[...referencedLocIds]]], ["complete_name","usage","removal_strategy_id","barcode","scrap_location","replenish_location","storage_category_id"], referencedLocIds.size);
    locations.push(...missingLocs);
    locMap = new Map(locations.map(l => [l.id, `loc-${l.id}`]));
  }

  // 5. Build nodes — positions assigned by autoLayout after import
  const COL_W = 260, ROW_H = 100, PAD = 60;
  const warehouseNodes = warehouses.map((wh, i) => ({
    id: `wh-${wh.id}`, type: "warehouse",
    label: wh.name, x: PAD + i * COL_W, y: 10,
    data: { code: wh.code, name: wh.name, reception_steps: wh.reception_steps || "one_step",
            delivery_steps: wh.delivery_steps || "one_step",
            buy_to_resupply: !!wh.buy_to_resupply, manufacture_to_resupply: !!wh.manufacture_to_resupply },
  }));
  const locationNodes = locations.map((loc, i) => ({
    id: `loc-${loc.id}`, type: "location",
    label: loc.complete_name?.split("/").pop()?.trim() || loc.complete_name,
    x: PAD + (i % 6) * COL_W, y: 100 + Math.floor(i / 6) * ROW_H,
    data: { complete_name: loc.complete_name, usage: loc.usage,
            removal_strategy: rname(loc.removal_strategy_id) || "fifo", barcode: loc.barcode || "",
            scrap_location: !!loc.scrap_location,
            replenish_location: !!loc.replenish_location,
            storage_category_id: rname(loc.storage_category_id) || "" },
  }));

  // 6. Operation types
  const operationTypes = pickingTypes
    .filter(pt => pt.default_location_src_id && pt.default_location_dest_id)
    .map(pt => ({
      id: `op-${pt.id}`, label: pt.name,
      code: pt.code, sequence_code: pt.sequence_code || "",
      src_location_id:  locMap.get(rid(pt.default_location_src_id))  || "",
      dest_location_id: locMap.get(rid(pt.default_location_dest_id)) || "",
      data: { name: pt.name, code: pt.code, sequence_code: pt.sequence_code || "",
              create_backorder: pt.create_backorder || "ask",
              reservation_method: pt.reservation_method || "at_confirm",
              use_create_lots: !!pt.use_create_lots, use_existing_lots: !!pt.use_existing_lots,
              show_reserved: !!pt.show_reserved },
    }));

  // 7. Routes + nested rules
  const rulesByRoute = new Map();
  for (const rule of rules) {
    const rId = rid(rule.route_id);
    if (!rulesByRoute.has(rId)) rulesByRoute.set(rId, []);
    rulesByRoute.get(rId).push(rule);
  }
  const appRoutes = routes.map((route, i) => ({
    id: `route-${route.id}`, label: route.name,
    colorIdx: i % ROUTE_COLORS.length,
    data: { name: route.name, active: route.active,
            product_selectable: !!route.product_selectable, product_categ_selectable: !!route.product_categ_selectable,
            warehouse_selectable: !!route.warehouse_selectable, sale_selectable: !!route.sale_selectable },
    rules: (rulesByRoute.get(route.id) || []).map(rule => ({
      id: `rl-${rule.id}`, label: rule.name,
      action: rule.action, procure_method: rule.procure_method,
      src_location_id:  locMap.get(rid(rule.location_src_id))  || "",
      dest_location_id: locMap.get(rid(rule.location_dest_id)) || "",
      picking_type_id:  opMap.get(rid(rule.picking_type_id))   || "",
      auto: rule.auto || "manual",
      data: { name: rule.name, action: rule.action, procure_method: rule.procure_method,
              auto: rule.auto || "manual", propagate_cancel: !!rule.propagate_cancel, delay: rule.delay || 0 },
    })),
  }));

  // 8. Storage categories (best-effort: model exists in stock module from Odoo 16+)
  let storageCategories = [];
  let catMap = new Map();
  try {
    onProgress("Fetching storage categories…");
    const cats = await sr("stock.storage.category", [], ["name", "allow_new_product", "max_weight"]);
    storageCategories = cats.map(c => ({
      id: `cat-${c.id}`,
      name: c.name,
      allow_new_product: c.allow_new_product || "mixed_products",
      max_weight: c.max_weight || 0,
      capacity_qty: 0, // capacity_ids o2m fetch deferred — leave 0 until a per-product capacity UI lands
    }));
    catMap = new Map(cats.map(c => [c.id, `cat-${c.id}`]));
  } catch (e) {
    // Module may be absent on customer installs; degrade silently.
    console.warn("storage_category fetch skipped:", e?.message || e);
  }

  // 9. Putaway rules
  const putawayRules = putaway.map(p => ({
    id: `pa-${p.id}`,
    location_in_id: locMap.get(rid(p.location_in_id)) || "",
    location_out_id: locMap.get(rid(p.location_out_id)) || "",  // m2o → app id
    location_out: rname(p.location_out_id),                       // legacy display string
    product: rname(p.product_id),
    category: rname(p.category_id),
    sequence: p.sequence ?? 99,
    storage_strategy: p.storage_strategy || "manual_no_strategy",
    storage_category_id: catMap.get(rid(p.storage_category_id)) || rname(p.storage_category_id) || "",
  }));

  // 10. Quants — aggregate per location for the heatmap. Best-effort, fetches on every
  //     full inventory pull. Light: only `location_id` and `quantity`.
  let _quantsByLocation = {};
  try {
    onProgress("Fetching stock quants for heatmap…");
    const quants = await fetchAll(
      "stock.quant",
      [["location_id.usage", "=", "internal"], ["quantity", ">", 0]],
      ["location_id", "quantity"], 1000,
      n => onProgress(`Fetching quants… (${n})`),
    );
    for (const q of quants) {
      const lid = rid(q.location_id);
      const appId = locMap.get(lid);
      if (!appId) continue;
      _quantsByLocation[appId] = (_quantsByLocation[appId] || 0) + (q.quantity || 0);
    }
  } catch (e) {
    console.warn("quant fetch skipped:", e?.message || e);
  }

  const data = {
    nodes: [...warehouseNodes, ...locationNodes],
    operationTypes, routes: appRoutes, putawayRules,
    storageCategories,
    _quantsByLocation,
  };
  return { data, userContext: session.user_context || {} };
}


// ─── HELP / INFO MODAL ───────────────────────────────────────────────────────
const HelpModal = ({ onClose }) => {
  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textSoft, textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${T.border}` }}>{title}</div>
      <div style={{ fontSize: 12, color: T.text, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
  const Kbd = ({ children }) => (
    <span style={{ display: "inline-block", padding: "1px 6px", margin: "0 2px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 3, fontSize: 10, color: T.text, fontFamily: "'IBM Plex Mono', monospace" }}>{children}</span>
  );
  const Pill = ({ color, children }) => (
    <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, background: `${color}1a`, color, fontSize: 10, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", textTransform: "uppercase", letterSpacing: "0.6px" }}>{children}</span>
  );
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 105, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
      <div style={{ width: 720, maxHeight: "85vh", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.35)" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 24, height: 24, borderRadius: 5, background: `linear-gradient(135deg, ${T.accent}, ${T.green})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>?</div>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Inventory Flow — Help</span>
          </div>
          <Btn variant="ghost" small icon="close" onClick={onClose} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>
          <Section title="What this is">
            A visual designer for Odoo inventory configuration. Each entity on the canvas
            maps 1:1 to a real Odoo record — locations, operation types (<code>stock.picking.type</code>),
            routes, rules, putaway rules — so the diagram is the spec <em>and</em> the data.
            Build it offline, then <b>Fetch</b> from a live Odoo to compare or <b>Push</b>
            your changes back.
          </Section>

          <Section title="Entities">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px 24px" }}>
              <div><span style={{ color: T.accent, fontWeight: 700 }}>⌂ Warehouse</span><br/><span style={{ color: T.textSoft, fontSize: 11 }}>Top-level container with reception/delivery/manufacture step counts.</span></div>
              <div><span style={{ color: T.green, fontWeight: 700 }}>◎ Location</span><br/><span style={{ color: T.textSoft, fontSize: 11 }}>Vendors, internal stock, customers, production, transit, etc.</span></div>
              <div><span style={{ color: T.amber, fontWeight: 700 }}>⛁ Operation Type</span><br/><span style={{ color: T.textSoft, fontSize: 11 }}>Groups moves (Pick / Pack / Receipt …) with default src + dest.</span></div>
              <div><span style={{ color: T.sky, fontWeight: 700 }}>⚡ Route</span><br/><span style={{ color: T.textSoft, fontSize: 11 }}>Named bundle of rules. Applicable on product / category / warehouse / SO.</span></div>
              <div><span style={{ color: T.text, fontWeight: 700 }}>→ Rule</span><br/><span style={{ color: T.textSoft, fontSize: 11 }}>The colored arrow on the canvas. One rule = one stock-move trigger.</span></div>
              <div><span style={{ color: T.violet, fontWeight: 700 }}>⇲ Putaway</span><br/><span style={{ color: T.textSoft, fontSize: 11 }}>Auto-storage rules per location. Edit via the badge on each location.</span></div>
            </div>
          </Section>

          <Section title="Reading an edge">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div><Pill color={T.accent}>pull</Pill> <span style={{ color: T.textSoft }}>solid line — fulfills demand at the destination by drawing from source.</span></div>
              <div><Pill color={T.accent}>push</Pill> <span style={{ color: T.textSoft }}>dashed line — fires when stock arrives at the source.</span></div>
              <div><Pill color={T.accent}>pull+push</Pill> <span style={{ color: T.textSoft }}>dotted line — both directions trigger.</span></div>
              <div><Pill color={T.accent}>buy / make</Pill> <span style={{ color: T.textSoft }}>$ or ⚙ glyph at midpoint — resolved via PO or MO.</span></div>
              <div style={{ marginTop: 4 }}><b>● MTO</b> (filled dot near dest end) — chains another rule to source the demand.<br/><b>○ MTS</b> (hollow dot) — takes from stock, stops at source.</div>
              <div style={{ marginTop: 4 }}><b>↳ Umbrella rule</b> — wider semi-transparent halo behind the line means the rule's destination doesn't match its picking type's destination, so other rules complete the chain.</div>
            </div>
          </Section>

          <Section title="Adding things">
            <ul style={{ margin: 0, paddingLeft: 20, color: T.text }}>
              <li><b>Drag from a port</b> (the colored dots on each location's edges) to draw a rule between two locations.</li>
              <li><b>Add → Location / Warehouse</b> enters placement mode — a draft tile follows your cursor; click anywhere to drop.</li>
              <li><b>Add → Op Type / Route</b> creates immediately and selects so the side panel opens.</li>
              <li><b>From Template</b> in the Add menu replaces the canvas with one of 8 starter scenarios.</li>
            </ul>
          </Section>

          <Section title="Selecting & moving">
            <ul style={{ margin: 0, paddingLeft: 20, color: T.text }}>
              <li><b>Click</b> to select. <b>Shift + click</b> toggles in multi-select.</li>
              <li><b>Shift + drag from empty canvas</b> = lasso selection.</li>
              <li><b>Drag</b> any selected node to move it (or the whole multi-selection).</li>
              <li><b>Hold <Kbd>Space</Kbd></b> + drag to pan from anywhere — including over nodes.</li>
              <li><b>Double-click a node label</b> to rename inline.</li>
              <li><b>Right-click</b> any node or op-type for the context menu.</li>
            </ul>
          </Section>

          <Section title="Keyboard shortcuts">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", fontSize: 11 }}>
              <div><Kbd>Ctrl+K</Kbd> / <Kbd>/</Kbd> — Command palette</div>
              <div><Kbd>Ctrl+Z</Kbd> / <Kbd>Ctrl+Y</Kbd> — Undo / Redo</div>
              <div><Kbd>Ctrl+A</Kbd> — Select all visible</div>
              <div><Kbd>Ctrl+D</Kbd> — Duplicate selected</div>
              <div><Kbd>Esc</Kbd> — Clear selection / cancel</div>
              <div><Kbd>Del</Kbd> / <Kbd>Backspace</Kbd> — Delete selected</div>
              <div><Kbd>F</Kbd> — Focus selection in viewport</div>
              <div><Kbd>↑↓←→</Kbd> — Nudge 8px (<Kbd>Shift</Kbd> = 1px)</div>
              <div><Kbd>[</Kbd> / <Kbd>]</Kbd> — Send back / bring forward</div>
              <div><Kbd>Ctrl+[</Kbd> / <Kbd>Ctrl+]</Kbd> — To back / to front</div>
              <div><Kbd>Space</Kbd> + drag — Pan from background</div>
              <div><Kbd>Alt</Kbd> + drag — Pan from anywhere (over nodes too)</div>
              <div><Kbd>Middle-click</Kbd> + drag — Pan from anywhere</div>
              <div><Kbd>Scroll</Kbd> — Zoom in/out at cursor</div>
              <div><Kbd>Ctrl+S</Kbd> — Save (export JSON)</div>
              <div><Kbd>Ctrl+O</Kbd> — Open (import JSON)</div>
              <div><Kbd>Shift</Kbd> + click — Multi-select / lasso</div>
              <div><Kbd>Shift</Kbd>+drag bg — Lasso-select</div>
              <div><Kbd>Right-click</Kbd> bg — Quick-add menu (incl. wizard)</div>
              <div><Kbd>1</Kbd> / <Kbd>2</Kbd> / <Kbd>3</Kbd> — Cycle op-viz mode</div>
              <div><Kbd>L</Kbd> — Auto-layout</div>
              <div><Kbd>0</Kbd> — Reset zoom / fit-to-content</div>
            </div>
          </Section>

          <Section title="Live Odoo (standalone)">
            <ol style={{ margin: 0, paddingLeft: 20, color: T.text }}>
              <li>Open the <b>⚙ settings</b> button in the toolbar, fill in URL / DB / login / API key.</li>
              <li>Click <b>Test</b> to verify, then close.</li>
              <li><b>Fetch from Odoo</b> replaces the diagram with live data and snapshots it for diffing.</li>
              <li>Edit in the canvas; <b>Push to Odoo</b> applies the diff back via JSON-RPC.</li>
              <li>If you opened the standalone HTML directly (file://), run <Kbd>npm run proxy</Kbd> first and use <code>localhost:4173</code> to avoid CORS.</li>
            </ol>
          </Section>

          <Section title="Live Odoo (Konu module)">
            When this is opened from inside Konu's Odoo via <code>/konu_tools/visualiser/&lt;id&gt;</code>,
            credentials are server-side. The customer name shows in the toolbar instead of a settings cog.
            Whether writes are allowed depends on the connection's <code>allow_write</code> flag.
          </Section>
        </div>
        <div style={{ padding: "10px 22px", borderTop: `1px solid ${T.border}`, fontSize: 10, color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", display: "flex", justifyContent: "space-between" }}>
          <span>Esc to close</span>
          <span>v1 — built on React + esbuild</span>
        </div>
      </div>
    </div>
  );
};

// ─── RIGHT-CLICK CONTEXT MENU ────────────────────────────────────────────────
const ContextMenu = ({ x, y, items, onClose }) => {
  useEffect(() => {
    const close = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div onMouseDown={onClose}
         style={{ position: "fixed", inset: 0, zIndex: 105 }}>
      <div onMouseDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}
           style={{ position: "absolute", left: x, top: y,
                    minWidth: 200, padding: 4,
                    background: T.surface, border: `1px solid ${T.border}`,
                    borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                    fontFamily: "'IBM Plex Sans', sans-serif" }}>
        {items.map((it, i) => it.divider ? (
          <div key={`d${i}`} style={{ height: 1, background: T.border, margin: "4px 0" }} />
        ) : (
          <div key={it.id || i} onClick={() => { it.run(); onClose(); }}
               style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                        borderRadius: 4, cursor: "pointer", fontSize: 12, color: it.danger ? T.rose : T.text }}
               onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
               onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <span style={{ width: 14, color: it.color || (it.danger ? T.rose : T.textSoft), fontSize: 11 }}>
              {it.icon || "·"}
            </span>
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.hotkey && <span style={{ fontSize: 9, color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", padding: "1px 5px", border: `1px solid ${T.border}`, borderRadius: 3 }}>{it.hotkey}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── COMMAND PALETTE ─────────────────────────────────────────────────────────
// Fuzzy-search action launcher (Linear / Notion / VSCode style).
// Open via Ctrl+K (or Cmd+K). Commands are passed in from App so each one
// captures the closures it needs (doAdd, autoLayout, fetchFromOdoo, etc.).
function scoreCommand(cmd, q) {
  if (!q) return 1;
  const hay = ((cmd.label || "") + " " + (cmd.group || "") + " " + (cmd.keywords || "")).toLowerCase();
  if (hay.includes(q)) {
    const labelLower = (cmd.label || "").toLowerCase();
    return labelLower.startsWith(q) ? 100 : labelLower.includes(q) ? 60 : 30;
  }
  // subsequence match — every q char appears in order
  let i = 0;
  for (let k = 0; k < hay.length && i < q.length; k++) {
    if (hay[k] === q[i]) i++;
  }
  return i === q.length ? Math.max(5, 25 - q.length) : 0;
}

const CommandPalette = ({ commands, onClose }) => {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const scored = commands
      .map(c => ({ c, s: scoreCommand(c, ql) }))
      .filter(x => x.s > 0);
    scored.sort((a, b) => b.s - a.s || a.c.label.localeCompare(b.c.label));
    return scored.map(x => x.c).slice(0, 60);
  }, [q, commands]);

  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[idx];
      if (c) { c.run(); onClose(); }
    }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  // Group label header rendering — collapse same group between consecutive items
  let lastGroup = null;

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 110, paddingTop: "12vh", fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
      <div style={{ width: 540, maxHeight: "70vh", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.35)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, gap: 8 }}>
          <span style={{ fontSize: 13, color: T.textSoft, fontFamily: "'IBM Plex Mono', monospace" }}>›</span>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search commands…  (templates, fetch, fit, push, theme …)"
            style={{ flex: 1, background: "transparent", border: "none", color: T.text, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
          <span style={{ fontSize: 9, color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", padding: "2px 6px", border: `1px solid ${T.border}`, borderRadius: 3 }}>esc</span>
        </div>
        <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 4 }}>
          {filtered.length === 0 && (
            <div style={{ padding: "20px 14px", fontSize: 11, color: T.textDim, textAlign: "center" }}>
              No matching commands.
            </div>
          )}
          {filtered.map((c, i) => {
            const showHeader = c.group && c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <React.Fragment key={c.id || i}>
                {showHeader && (
                  <div style={{ padding: "6px 10px 2px", fontSize: 8, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.7px" }}>
                    {c.group}
                  </div>
                )}
                <div data-idx={i}
                  onClick={() => { c.run(); onClose(); }}
                  onMouseEnter={() => setIdx(i)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                           background: i === idx ? T.accentSoft : "transparent",
                           color: T.text }}>
                  <span style={{ width: 16, textAlign: "center", fontSize: 11, color: c.color || T.textSoft, flexShrink: 0, fontWeight: 600 }}>
                    {c.icon || "·"}
                  </span>
                  <div style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: T.text, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", flexShrink: 0 }}>
                      {c.label}
                    </span>
                    {c.hint && (
                      <span style={{ fontSize: 10, color: T.textDim, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", minWidth: 0 }}>
                        {c.hint}
                      </span>
                    )}
                  </div>
                  {c.hotkey && (
                    <span style={{ fontSize: 9, color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", padding: "1px 5px", border: `1px solid ${T.border}`, borderRadius: 3, flexShrink: 0 }}>
                      {c.hotkey}
                    </span>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px", borderTop: `1px solid ${T.border}`, fontSize: 9, color: T.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>
          <span>↑↓ navigate · ⏎ run</span>
          <span>{filtered.length} command{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
};

// ─── STORAGE CATEGORY MODAL ─────────────────────────────────────────────
// CRUD over data.storageCategories. Each row: name | allow_new_product |
// max_weight | capacity_qty | × delete. + Add row at bottom.
const StorageCategoryModal = ({ categories, onUpdate, onClose }) => {
  const [items, setItems] = useState(() => categories.map(c => ({ ...c })));
  const setField = (idx, key, value) => setItems(arr => arr.map((c, i) => i === idx ? { ...c, [key]: value } : c));
  const addRow = () => setItems(arr => [...arr, {
    id: `cat-${Math.random().toString(36).slice(2, 8)}`,
    name: 'New category', allow_new_product: 'mixed_products',
    max_weight: 0, capacity_qty: 0,
  }]);
  const delRow = (idx) => setItems(arr => arr.filter((_, i) => i !== idx));
  const save = () => { onUpdate(items); onClose(); };
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
      <div style={{ width: 720, maxHeight: "82vh", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Storage categories</span>
          <Btn variant="ghost" small icon="close" onClick={onClose} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <th style={{ textAlign: "left", padding: "6px 8px", color: T.textDim, fontWeight: 600 }}>Name</th>
                <th style={{ textAlign: "left", padding: "6px 8px", color: T.textDim, fontWeight: 600 }}>Allow new product</th>
                <th style={{ textAlign: "right", padding: "6px 8px", color: T.textDim, fontWeight: 600 }}>Max weight (kg)</th>
                <th style={{ textAlign: "right", padding: "6px 8px", color: T.textDim, fontWeight: 600 }}>Capacity qty</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: `1px solid ${T.border}55` }}>
                  <td style={{ padding: "4px 8px" }}>
                    <input value={c.name} onChange={e => setField(i, 'name', e.target.value)}
                      style={{ width: "100%", background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 11, padding: "3px 6px", borderRadius: 3, fontFamily: "inherit" }} />
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <select value={c.allow_new_product || 'mixed_products'} onChange={e => setField(i, 'allow_new_product', e.target.value)}
                      style={{ width: "100%", background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 11, padding: "3px 6px", borderRadius: 3, fontFamily: "inherit" }}>
                      <option value="mixed_products">Mixed products</option>
                      <option value="same_product">Same product</option>
                      <option value="only_empty">Only when empty</option>
                    </select>
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <input type="number" value={c.max_weight ?? 0} onChange={e => setField(i, 'max_weight', parseFloat(e.target.value) || 0)}
                      style={{ width: 80, background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 11, padding: "3px 6px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", textAlign: "right" }} />
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <input type="number" value={c.capacity_qty ?? 0} onChange={e => setField(i, 'capacity_qty', parseFloat(e.target.value) || 0)}
                      style={{ width: 80, background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 11, padding: "3px 6px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", textAlign: "right" }} />
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <button onClick={() => delRow(i)} title="Delete category"
                      style={{ background: "transparent", border: "none", color: T.red, fontSize: 14, cursor: "pointer" }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={addRow}
            style={{ marginTop: 8, padding: "5px 12px", background: T.accentSoft, color: T.accent, border: `1px solid ${T.accent}55`, borderRadius: 4, fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>+ Add category</button>
        </div>
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" small onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" small onClick={save}>Save</Btn>
        </div>
      </div>
    </div>
  );
};

// ─── TEST PUTAWAY MODAL ─────────────────────────────────────────────────
// Drill-in only: punch in product/category/qty, see simulator trace + result.
const TestPutawayModal = ({ data, locationId, onClose, simulate }) => {
  const [product, setProduct] = useState('');
  const [category, setCategory] = useState('');
  const [qty, setQty] = useState(1);
  const result = useMemo(() => simulate(data, {
    product: product.trim(), category: category.trim(),
    location_in_id: locationId, qty: parseFloat(qty) || 0,
  }), [data, locationId, product, category, qty, simulate]);
  const targetNode = result.resolvedLocationId ? data.nodes.find(n => n.id === result.resolvedLocationId) : null;
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
      <div style={{ width: 540, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Test putaway · {data.nodes.find(n => n.id === locationId)?.label || locationId}</span>
          <Btn variant="ghost" small icon="close" onClick={onClose} />
        </div>
        <div style={{ padding: 14, fontSize: 11 }}>
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 8, marginBottom: 14 }}>
            <label style={{ color: T.textDim, alignSelf: "center" }}>Product</label>
            <input value={product} onChange={e => setProduct(e.target.value)} placeholder="e.g. Office Desk"
              style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 11, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }} />
            <label style={{ color: T.textDim, alignSelf: "center" }}>Category</label>
            <input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Electronics"
              style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 11, padding: "5px 8px", borderRadius: 4, fontFamily: "inherit" }} />
            <label style={{ color: T.textDim, alignSelf: "center" }}>Quantity</label>
            <input type="number" value={qty} onChange={e => setQty(e.target.value)}
              style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text, fontSize: 11, padding: "5px 8px", borderRadius: 4, fontFamily: "'IBM Plex Mono', monospace", width: 100 }} />
          </div>
          <div style={{ background: T.surfaceHover, borderRadius: 5, padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ color: T.textDim, fontSize: 10, marginBottom: 6, fontFamily: "'IBM Plex Mono', monospace" }}>Trace</div>
            {result.trace.length === 0 && <div style={{ color: T.textDim, fontStyle: "italic" }}>(enter inputs above)</div>}
            {result.trace.map((step, i) => (
              <div key={i} style={{ color: T.text, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, marginBottom: 2 }}>{step}</div>
            ))}
          </div>
          <div style={{ padding: "10px 12px", borderRadius: 5,
            background: result.capacityCheck === 'ok' ? T.greenSoft :
                        result.capacityCheck === 'over' ? T.amberSoft : T.surfaceHover,
            border: `1px solid ${result.capacityCheck === 'over' ? T.amber : T.border}` }}>
            <div style={{ fontWeight: 700, color:
              result.capacityCheck === 'ok' ? T.green :
              result.capacityCheck === 'over' ? T.amber : T.text }}>
              {targetNode
                ? `${result.capacityCheck === 'over' ? '✕' : '✓'} ${targetNode.label}`
                : '— no resolution'}
            </div>
            <div style={{ color: T.textDim, marginTop: 4 }}>{result.reason}</div>
          </div>
        </div>
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end" }}>
          <Btn variant="primary" small onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
};

// ─── CONNECT-TARGET MODAL (drag-from-port) ──────────────────────────────────
// Tiny modal: pick a route + action and create a rule with src/dest pre-filled.
const ConnectModal = ({ srcLabel, dstLabel, routes, onCreate, onCreateInNewRoute, onClose }) => {
  const [action, setAction] = useState("pull");
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'IBM Plex Sans', sans-serif" }} onClick={onClose}>
      <div style={{ width: 380, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>New Rule</span>
          <Btn variant="ghost" small icon="close" onClick={onClose} />
        </div>
        <div style={{ padding: "10px 18px 4px" }}>
          <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: T.text, padding: "8px 10px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 5, marginBottom: 12, textAlign: "center" }}>
            <span style={{ color: T.textSoft }}>{srcLabel}</span>
            <span style={{ margin: "0 10px", color: T.accent }}>→</span>
            <span style={{ color: T.textSoft }}>{dstLabel}</span>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {[{ k: "pull", l: "Pull" }, { k: "push", l: "Push" }, { k: "pull_push", l: "Pull+Push" }, { k: "buy", l: "Buy" }, { k: "manufacture", l: "Make" }].map(a => (
              <button key={a.k} onClick={() => setAction(a.k)}
                style={{ flex: 1, padding: "5px 4px", background: action === a.k ? T.accent : "transparent", color: action === a.k ? "#fff" : T.textSoft, border: `1px solid ${action === a.k ? T.accent : T.border}`, borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                {a.l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: "0 8px 8px", maxHeight: 280, overflowY: "auto" }}>
          <div style={{ padding: "4px 10px 6px", fontSize: 8, fontWeight: 700, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.6px" }}>Add to route</div>
          {routes.length === 0 && <div style={{ padding: "8px 10px", fontSize: 10, color: T.textDim }}>No routes yet — create a new one below.</div>}
          {routes.map(r => {
            const rc = ROUTE_COLORS[r.colorIdx % ROUTE_COLORS.length];
            return (
              <button key={r.id} onClick={() => onCreate(r.id, action)}
                style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", background: "transparent", border: "none", borderRadius: 5, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
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
          <button onClick={() => onCreateInNewRoute(action)}
            style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", background: "transparent", border: `1px dashed ${T.border}`, borderRadius: 5, cursor: "pointer", textAlign: "left", fontFamily: "inherit", marginTop: 4 }}
            onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: T.sky, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.sky }}>+ New route</div>
              <div style={{ fontSize: 9, color: T.textDim }}>Creates a route then adds the rule to it</div>
            </div>
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
  const [isDark, setIsDark] = useState(false); // light default — flip with the ☾ toggle
  const [compact, setCompact] = useState(false); // toolbar density toggle
  syncTheme(isDark); // keep T & nodeStyles in sync before every render
  const [data, setData] = useState(initData);
  const [scale, setScale] = useState(0.72);
  const [offset, setOffset] = useState({ x: 240, y: 30 });
  const [sel, setSel] = useState(null);
  const [isPan, setIsPan] = useState(false);
  const [panSt, setPanSt] = useState({ x: 0, y: 0 });
  const [dragId, setDragId] = useState(null);
  const [dragT, setDragT] = useState(null);
  const [dragOff, setDragOff] = useState({ x: 0, y: 0 });
  // When dragging a warehouse: { warehouseId, anchorX0, anchorY0, members: [{ id, x0, y0 }] }
  // Lets the warehouse drag its child locations (and via them, op-type blobs) as a rigid group.
  const [dragGroup, setDragGroup] = useState(null);
  const [hidden, setHidden] = useState(new Set());
  const [showCfg, setShowCfg] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [shrinkPending, setShrinkPending] = useState(null); // { diff, warehouse, fieldLabel, oldValue, newValue, warehouseId, fieldKey }
  const [showInactive, setShowInactive] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [apiCfg, setApiCfg] = useState(() => KONU_CFG
    ? { url: KONU_CFG.baseUrl || "", db: KONU_CFG.dbName || "", username: "konu", apiKey: "konu" }
    : { url: "", db: "", username: "", apiKey: "" });
  const [putawayLoc, setPutawayLoc] = useState(null); // locationId to show putaway panel for
  const [routeFilter, setRouteFilter] = useState("");
  const [multiSel, setMultiSel] = useState(new Set());
  const [showTips, setShowTips] = useState(false);
  const [fetchStatus, setFetchStatus] = useState(null); // null | { loading, progress } | { ok: true } | { error: string }
  const [pushStatus, setPushStatus] = useState(null); // null | { loading, progress } | { ok } | { error }
  const [showPushModal, setShowPushModal] = useState(null); // null | changes object
  const [fetchedSnapshot, setFetchedSnapshot] = useState(null); // deep copy of data after last fetch
  const [odooCtx, setOdooCtx] = useState({}); // Odoo user_context for write calls
  const [hideUnused, setHideUnused] = useState(false);
  // Op-type visualisation mode — replaces the older blob+leader-line UI.
  // 'pills'      = inline capsule pills at each rule's edge midpoint (default)
  // 'pills_wash' = pills + a faded color wash filling each op's src/dst bbox
  // 'hidden'     = no pills/wash by default; reveal a pill when its rule is hovered or selected
  const [opVizMode, setOpVizMode] = useState('pills');
  const [hoveredRuleId, setHoveredRuleId] = useState(null);
  // Drill-in viewport: when set to a location id, the canvas filters to
  // descendants of that location. null = main canvas. Persisted in URL hash
  // is overkill; in-memory state is enough — drill-in is a transient view.
  const [drillInto, setDrillInto] = useState(null);
  const [drillShowPutaway, setDrillShowPutaway] = useState(true);
  const [drillShowCategories, setDrillShowCategories] = useState(true);
  const [drillShowHeatmap, setDrillShowHeatmap] = useState(false);
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [showTestPutaway, setShowTestPutaway] = useState(false);
  const svgRef = useRef(null);
  const importRef = useRef(null);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Plan B: a deactivated entity has data.active === false AND
  // __autoGen.deactivated === true. Used to dim/hide entities the user
  // chose to keep but mark inactive instead of deleting.
  const isDeactivated = useCallback((e) =>
    e?.data?.active === false && e?.__autoGen?.deactivated === true, []);

  // Edge offsets for parallel/bidirectional rules — memoized so drag stays smooth
  const edgeOffsetMap = useMemo(() => buildEdgeOffsetMap(data.routes), [data.routes]);

  // Map each `view`-usage location to the leaf locations nested under it.
  // Detection: child's complete_name starts with parent's complete_name + "/", OR
  // child's data.location_id === parent.id.
  const viewChildren = useMemo(() => {
    const m = new Map();
    const locs = data.nodes.filter(n => n.type === "location");
    const views = locs.filter(l => l.data?.usage === "view");
    for (const v of views) {
      const vName = v.data?.complete_name || v.label || "";
      const kids = locs.filter(l => {
        if (l.id === v.id) return false;
        if (l.data?.location_id === v.id) return true;
        const cn = l.data?.complete_name || l.label || "";
        return vName && cn.startsWith(vName + "/");
      });
      m.set(v.id, { locations: kids });
    }
    return m;
  }, [data.nodes]);

  // Map each warehouse to its child locations (by complete_name path / code prefix)
  // and via that, the op-types that touch those locations.
  const warehouseChildren = useMemo(() => {
    const m = new Map();
    for (const wh of data.nodes.filter(n => n.type === "warehouse")) {
      const code = wh.data?.code || wh.label || "";
      if (!code) { m.set(wh.id, { locations: [], opTypes: [] }); continue; }
      const locs = data.nodes.filter(n => {
        if (n.type !== "location") return false;
        const cn = n.data?.complete_name || n.label || "";
        return cn === code || cn.startsWith(code + "/");
      });
      const locIds = new Set(locs.map(l => l.id));
      const ops = data.operationTypes.filter(op => locIds.has(op.src_location_id) || locIds.has(op.dest_location_id));
      m.set(wh.id, { locations: locs, opTypes: ops });
    }
    return m;
  }, [data.nodes, data.operationTypes]);

  // Used location IDs (referenced in any rule src/dest or putaway rule)
  const usedLocationIds = useMemo(() => {
    const s = new Set();
    for (const route of data.routes) for (const rule of route.rules) {
      if (rule.src_location_id) s.add(rule.src_location_id);
      if (rule.dest_location_id) s.add(rule.dest_location_id);
    }
    for (const pr of data.putawayRules) {
      if (pr.location_in_id) s.add(pr.location_in_id);
    }
    return s;
  }, [data.routes, data.putawayRules]);

  // Export diagram to JSON file
  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data, apiCfg }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "odoo-inventory.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [data, apiCfg]);

  // Helper: turn the live SVG canvas into a self-contained <svg> string.
  // Computes the world-space bounding box of all visible nodes/op-types and
  // re-projects the SVG so the export is tightly cropped (not the viewport).
  const buildExportSvg = useCallback(() => {
    if (!svgRef.current) return null;
    const clone = svgRef.current.cloneNode(true);

    // Compute world-space bbox by unioning every visual element's actual extents:
    //   - leaf location/warehouse nodes: their NW × NH rect
    //   - warehouse blobs: child-cluster + 80px PAD + 14px name tag
    //   - view-location blobs: nested-children + 36px PAD + 11px name tag
    //   - op-type blobs: src+dest cluster + 30px PAD
    //   - op-type label callouts: blob position + labelDx/Dy + ~280px wide tag
    const visibleNodes = data.nodes.filter(n => !(hideUnused && n.type === "location" && !usedLocationIds.has(n.id)));
    if (visibleNodes.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (x, y, w = 0, h = 0) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    };

    // Leaf nodes
    for (const n of visibleNodes) include(n.x, n.y, NW, NH);

    // Warehouse blobs (auto-fit to their visible children + 80px pad + name-tag)
    for (const wh of visibleNodes.filter(n => n.type === "warehouse")) {
      const code = wh.data?.code || wh.label || "";
      const kids = visibleNodes.filter(n => {
        if (n.type !== "location") return false;
        const cn = n.data?.complete_name || n.label || "";
        return cn === code || cn.startsWith(code + "/");
      });
      if (kids.length === 0) continue;
      let kMinX = Infinity, kMinY = Infinity, kMaxX = -Infinity, kMaxY = -Infinity;
      for (const k of kids) {
        if (k.x < kMinX) kMinX = k.x;
        if (k.y < kMinY) kMinY = k.y;
        if (k.x + NW > kMaxX) kMaxX = k.x + NW;
        if (k.y + NH > kMaxY) kMaxY = k.y + NH;
      }
      include(kMinX - 80, kMinY - 80 - 14, (kMaxX - kMinX) + 160, (kMaxY - kMinY) + 160 + 14);
    }

    // Op-type blobs + label callouts
    for (const op of data.operationTypes) {
      const sn = data.nodes.find(n => n.id === op.src_location_id);
      const dn = data.nodes.find(n => n.id === op.dest_location_id);
      if (!sn || !dn) continue;
      const oMinX = Math.min(sn.x, dn.x) - 30;
      const oMinY = Math.min(sn.y, dn.y) - 30;
      const oMaxX = Math.max(sn.x + NW, dn.x + NW) + 30;
      const oMaxY = Math.max(sn.y + NH, dn.y + NH) + 30;
      include(oMinX, oMinY, oMaxX - oMinX, oMaxY - oMinY);
      // Label callout — default position is (blob.minX + 6, blob.minY - 14), then offset
      const lx = oMinX + 6 + (op.labelDx || 0);
      const ly = oMinY - 14 + (op.labelDy || 0);
      include(lx, ly, 280, 22);
    }

    // Final padding so the boundary itself isn't tight
    const FINAL_PAD = 24;
    minX -= FINAL_PAD; minY -= FINAL_PAD; maxX += FINAL_PAD; maxY += FINAL_PAD;
    const w = maxX - minX, h = maxY - minY;
    // Re-create as a fresh SVG with the right viewBox (ignores current pan/zoom).
    // We can't easily re-render — easier to wrap the clone in a transform that
    // negates the current screen offset/scale and produces world coords.
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", Math.round(w));
    clone.setAttribute("height", Math.round(h));
    // The live SVG has all coords in screen space (offset.x + scale*world). Reproject:
    // wrap children in a <g transform="translate(-offset.x,-offset.y) scale(1/scale) translate(-minX,-minY)">
    const wrap = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const t = `translate(${-minX},${-minY}) scale(${1 / scale}) translate(${-offset.x},${-offset.y})`;
    wrap.setAttribute("transform", t);
    while (clone.firstChild) wrap.appendChild(clone.firstChild);
    clone.appendChild(wrap);
    clone.setAttribute("viewBox", `0 0 ${Math.round(w)} ${Math.round(h)}`);
    // Fill bg so the export isn't transparent
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", 0); bg.setAttribute("y", 0);
    bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%");
    bg.setAttribute("fill", T.bg);
    clone.insertBefore(bg, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }, [data.nodes, scale, offset, hideUnused, usedLocationIds]);

  const handleExportSvg = useCallback(() => {
    const xml = buildExportSvg();
    if (!xml) return alert("Nothing to export.");
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "odoo-inventory.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [buildExportSvg]);

  const handleExportPng = useCallback(() => {
    const xml = buildExportSvg();
    if (!xml) return alert("Nothing to export.");
    // Parse w/h out of the SVG so the canvas matches
    const sizeMatch = xml.match(/width="(\d+)"\s+height="(\d+)"/);
    const w = sizeMatch ? parseInt(sizeMatch[1], 10) : 1200;
    const h = sizeMatch ? parseInt(sizeMatch[2], 10) : 800;
    const dpr = 2; // 2x for crisp on retina
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * dpr; canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = T.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, w * dpr, h * dpr);
      canvas.toBlob(blob => {
        if (!blob) return alert("PNG render failed (browser blocked the SVG-to-canvas pipeline).");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "odoo-inventory.png";
        a.click();
        URL.revokeObjectURL(a.href);
      }, "image/png");
    };
    img.onerror = () => alert("PNG render failed — try the SVG export instead.");
    img.src = url;
  }, [buildExportSvg]);

  const handleExportPdf = useCallback(() => {
    // Open the SVG in a new window with a print-friendly stylesheet, then trigger print.
    // The user picks "Save as PDF" in the browser's print dialog.
    const xml = buildExportSvg();
    if (!xml) return alert("Nothing to export.");
    const w = window.open("", "_blank");
    if (!w) return alert("Popup blocked — allow popups for this site to export PDF.");
    w.document.write(`<!doctype html><html><head><title>Odoo Inventory Flow</title>
      <style>
        @page { margin: 12mm; size: landscape; }
        body { margin: 0; padding: 0; font-family: system-ui, sans-serif; }
        svg { max-width: 100%; height: auto; }
      </style></head><body>${xml}<script>setTimeout(()=>window.print(), 250);</script></body></html>`);
    w.document.close();
  }, [buildExportSvg]);

  // Export the full setup as a Markdown handover document.
  const handleExportMarkdown = useCallback(() => {
    const md = exportMarkdown(data, { title: 'Warehouse Setup' });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `warehouse-setup-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  }, [data]);

  // Import diagram from JSON file
  const handleImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed.version !== 1 || !parsed.data) throw new Error("Invalid file format");
        const imported = backfillSequences(parsed.data);
        setData(prev => {
          historyRef.current = [...historyRef.current.slice(-49), prev];
          futureRef.current = [];
          setCanUndo(true); setCanRedo(false);
          return imported;
        });
        if (parsed.apiCfg) setApiCfg(parsed.apiCfg);
        setSel(null);
      } catch (err) {
        alert("Import failed: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  // Save a single item to Odoo (returns { ok } or { error })
  const saveItemToOdoo = useCallback(async (type, id, item) => {
    if (!apiCfg.url) return { error: "No Odoo connection configured" };
    const model = ODOO_MODEL[type];
    if (!model) return { error: `Unknown type: ${type}` };
    const oid = odooId(id);
    try {
      if (oid) {
        // Update existing
        const vals = toOdooVals(type, item);
        if (type === "rule") {
          // Find parent route for route_id
          const parentRoute = data.routes.find(r => r.rules.some(rl => rl.id === id));
          const routeOid = parentRoute ? odooId(parentRoute.id) : null;
          if (routeOid) vals.route_id = routeOid;
        }
        await odooWrite(apiCfg, odooCtx, model, oid, vals);
        return { ok: true };
      } else {
        // Create new
        const vals = toOdooVals(type, item);
        if (type === "rule") {
          const parentRoute = data.routes.find(r => r.rules.some(rl => rl.id === id));
          const routeOid = parentRoute ? odooId(parentRoute.id) : null;
          if (routeOid) vals.route_id = routeOid;
        }
        const newId = await odooCreate(apiCfg, odooCtx, model, vals);
        // Update app ID to reflect the new Odoo ID
        const prefix = id.split("-")[0];
        const newAppId = `${prefix}-${newId}`;
        setData(p => {
          const n = { ...p };
          if (["warehouse", "location"].includes(type)) {
            n.nodes = p.nodes.map(x => x.id === id ? { ...x, id: newAppId } : x);
          } else if (type === "operation_type") {
            n.operationTypes = p.operationTypes.map(x => x.id === id ? { ...x, id: newAppId } : x);
          } else if (type === "route") {
            n.routes = p.routes.map(x => x.id === id ? { ...x, id: newAppId } : x);
          } else if (type === "rule") {
            n.routes = p.routes.map(r => ({ ...r, rules: r.rules.map(x => x.id === id ? { ...x, id: newAppId } : x) }));
          } else if (type === "putaway_rule") {
            n.putawayRules = p.putawayRules.map(x => x.id === id ? { ...x, id: newAppId } : x);
          }
          return n;
        });
        return { ok: true, newId: newAppId };
      }
    } catch (err) {
      return { error: err.message || "Save failed" };
    }
  }, [apiCfg, odooCtx, data.routes]);

  // Bulk push all changes to Odoo
  const handlePushToOdoo = useCallback(async () => {
    const changes = computeChanges(data, fetchedSnapshot);
    if (changes.total === 0) { setPushStatus({ ok: "No changes to push" }); setTimeout(() => setPushStatus(null), 2000); return; }
    setShowPushModal(changes);
  }, [data, fetchedSnapshot]);

  const executePush = useCallback(async (changes) => {
    setShowPushModal(null);
    setPushStatus({ loading: true, progress: "Starting…" });
    const errors = [];
    // Creates first
    for (let i = 0; i < changes.creates.length; i++) {
      const { type, item } = changes.creates[i];
      setPushStatus({ loading: true, progress: `Creating ${type} ${i + 1}/${changes.creates.length}…` });
      const res = await saveItemToOdoo(type, item.id, item);
      if (res.error) { errors.push(`Create ${type} "${item.label}": ${res.error}`); break; }
    }
    if (errors.length === 0) {
      // Updates
      for (let i = 0; i < changes.updates.length; i++) {
        const { type, item } = changes.updates[i];
        setPushStatus({ loading: true, progress: `Updating ${type} ${i + 1}/${changes.updates.length}…` });
        const res = await saveItemToOdoo(type, item.id, item);
        if (res.error) { errors.push(`Update ${type} "${item.label}": ${res.error}`); break; }
      }
    }
    if (errors.length === 0) {
      // Deletes (deactivate)
      for (let i = 0; i < changes.deletes.length; i++) {
        const { type, oid } = changes.deletes[i];
        const model = ODOO_MODEL[type];
        setPushStatus({ loading: true, progress: `Deactivating ${type} ${i + 1}/${changes.deletes.length}…` });
        try { await odooDeactivate(apiCfg, odooCtx, model, oid); }
        catch (err) { errors.push(`Deactivate ${type} ID ${oid}: ${err.message}`); break; }
      }
    }
    if (errors.length > 0) {
      setPushStatus({ error: errors.join("\n") });
    } else {
      setPushStatus({ ok: `Pushed ${changes.total} changes` });
      // Re-snapshot current state as the new baseline
      setFetchedSnapshot(JSON.parse(JSON.stringify(data)));
      setTimeout(() => setPushStatus(null), 3000);
    }
  }, [apiCfg, odooCtx, data, saveItemToOdoo]);

  // Putaway rule handlers
  const putawayUpdate = useCallback((ruleId, upd) => {
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      return { ...p, putawayRules: p.putawayRules.map(r => r.id === ruleId ? { ...r, ...upd } : r) };
    });
  }, []);
  const putawayAdd = useCallback((locId) => {
    const ts = Date.now();
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      return { ...p, putawayRules: [...p.putawayRules, { id: `pa-${ts}`, location_in_id: locId, location_out: "", product: "", category: "", sequence: 99, storage_strategy: "manual_no_strategy", storage_category_id: "" }] };
    });
  }, []);
  const putawayDelete = useCallback((ruleId) => {
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      return { ...p, putawayRules: p.putawayRules.filter(r => r.id !== ruleId) };
    });
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
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
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
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      const n = { ...p };
      if (["warehouse", "location", "putaway_rule"].includes(type)) n.nodes = p.nodes.filter(x => x.id !== id);
      else if (type === "operation_type") n.operationTypes = p.operationTypes.filter(x => x.id !== id);
      else if (type === "route") n.routes = p.routes.filter(x => x.id !== id);
      else if (type === "rule") n.routes = p.routes.map(r => ({ ...r, rules: r.rules.filter(x => x.id !== id) }));
      return n;
    });
    setSel(null);
  }, []);

  const doAdd = useCallback((type, posOverride) => {
    // Locations & warehouses get the placement-tile UX (click-to-drop)
    // unless a position is explicitly provided (i.e. the placement-tile click handler).
    if ((type === "location" || type === "warehouse") && !posOverride) {
      setPlacement({ type });
      setShowAdd(false);
      return;
    }
    const cx = posOverride?.x ?? ((-offset.x + 500) / scale);
    const cy = posOverride?.y ?? ((-offset.y + 300) / scale);
    const ts = Date.now();
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      const n = { ...p };
      if (["location", "warehouse", "putaway_rule"].includes(type)) {
        const defs = {};
        (fieldDefs[type] || []).forEach(f => {
          if (f.type === "group") return;
          defs[f.key] = f.type === "boolean" ? false : f.type === "number" ? 0 : f.type === "select" ? (f.options?.[0]?.value || "") : f.type === "m2m" ? [] : "";
        });
        n.nodes = [...p.nodes, { id: `${type.slice(0, 3)}-${ts}`, type, label: `New ${type.replace(/_/g, " ")}`, x: cx, y: cy, data: defs }];
        // Auto-select so user can immediately rename / edit
        setTimeout(() => doSelect(`${type.slice(0, 3)}-${ts}`), 20);
      } else if (type === "operation_type") {
        const locs = p.nodes.filter(x => x.type === "location");
        n.operationTypes = [...p.operationTypes, { id: `op-${ts}`, label: "New Operation", code: "internal", sequence_code: "NEW", src_location_id: locs[0]?.id || "", dest_location_id: locs[1]?.id || locs[0]?.id || "", data: { name: "New Operation", code: "internal", sequence_code: "NEW", create_backorder: "ask", reservation_method: "at_confirm", use_create_lots: false, use_existing_lots: true, show_reserved: true } }];
        setTimeout(() => doSelect(`op-${ts}`), 20);
      } else if (type === "route") {
        n.routes = [...p.routes, { id: `route-${ts}`, label: "New Route", colorIdx: p.routes.length % ROUTE_COLORS.length, data: { name: "New Route", active: true, product_selectable: false, product_categ_selectable: false, warehouse_selectable: true, sale_selectable: false, }, rules: [] }];
        setTimeout(() => doSelect(`route-${ts}`), 20);
      }
      return n;
    });
    setShowAdd(false);
  }, [offset, scale, doSelect]);

  const addRuleToRoute = useCallback((routeId) => {
    const ts = Date.now();
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
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

  // Duplicate a node or operation type (cloned with " copy" suffix, +24/+24 offset)
  const duplicateItem = useCallback((type, id) => {
    const ts = Date.now();
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true); setCanRedo(false);
      if (type === "warehouse" || type === "location") {
        const orig = p.nodes.find(n => n.id === id);
        if (!orig) return p;
        const newId = `${type.slice(0, 3)}-${ts}`;
        const clone = { ...orig, id: newId, label: `${orig.label} copy`, x: (orig.x || 0) + 24, y: (orig.y || 0) + 24, data: { ...(orig.data || {}) } };
        setTimeout(() => doSelect(newId), 20);
        return { ...p, nodes: [...p.nodes, clone] };
      }
      if (type === "operation_type") {
        const orig = p.operationTypes.find(o => o.id === id);
        if (!orig) return p;
        const newId = `op-${ts}`;
        const clone = { ...orig, id: newId, label: `${orig.label} copy`, data: { ...(orig.data || {}), name: `${orig.data?.name || orig.label} copy` } };
        setTimeout(() => doSelect(newId), 20);
        return { ...p, operationTypes: [...p.operationTypes, clone] };
      }
      if (type === "route") {
        const orig = p.routes.find(r => r.id === id);
        if (!orig) return p;
        const newRouteId = `route-${ts}`;
        const newRules = orig.rules.map((r, i) => ({ ...r, id: `rule-${ts}-${i}` }));
        const clone = { ...orig, id: newRouteId, label: `${orig.label} copy`, data: { ...(orig.data || {}), name: `${orig.data?.name || orig.label} copy` }, rules: newRules };
        setTimeout(() => doSelect(newRouteId), 20);
        return { ...p, routes: [...p.routes, clone] };
      }
      return p;
    });
  }, [doSelect]);

  // Add a rule with src/dest pre-filled (used by the draw-line-to-rule flow)
  const addRuleWithEndpoints = useCallback((routeId, srcId, dstId, action = "pull") => {
    const ts = Date.now();
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true); setCanRedo(false);
      const sLabel = p.nodes.find(n => n.id === srcId)?.label || "?";
      const dLabel = p.nodes.find(n => n.id === dstId)?.label || "?";
      const procure = action === "push" ? "make_to_stock" : "make_to_order";
      const newRule = {
        id: `rule-${ts}`,
        label: `${sLabel} → ${dLabel}`,
        action, procure_method: procure,
        src_location_id: srcId, dest_location_id: dstId,
        picking_type_id: p.operationTypes[0]?.id || "", auto: "manual",
        data: { name: `${sLabel} → ${dLabel}`, action, procure_method: procure, auto: "manual", propagate_cancel: false, delay: 0 },
      };
      return { ...p, routes: p.routes.map(r => r.id === routeId ? { ...r, rules: [...r.rules, newRule] } : r) };
    });
    setTimeout(() => doSelect(`rule-${ts}`), 20);
  }, [doSelect]);

  // Z-order helpers
  const zReorder = useCallback((dir) => {
    // dir: "front" | "back" | "fwd" | "bwd"
    const targetIds = sel ? new Set([sel.id]) : multiSel.size > 0 ? new Set(multiSel) : null;
    if (!targetIds || targetIds.size === 0) return;
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true); setCanRedo(false);
      const apply = (arr) => {
        if (!arr.some(x => targetIds.has(x.id))) return arr;
        const zs = arr.map(x => x.z || 0);
        const maxZ = Math.max(0, ...zs), minZ = Math.min(0, ...zs);
        return arr.map(x => {
          if (!targetIds.has(x.id)) return x;
          if (dir === "front") return { ...x, z: maxZ + 1 };
          if (dir === "back")  return { ...x, z: minZ - 1 };
          if (dir === "fwd")   return { ...x, z: (x.z || 0) + 1 };
          if (dir === "bwd")   return { ...x, z: (x.z || 0) - 1 };
          return x;
        });
      };
      return { ...p, nodes: apply(p.nodes), operationTypes: apply(p.operationTypes) };
    });
  }, [sel, multiSel]);

  // Build a contextual menu for any selected entity (rendered as a fixed-position popup)
  const openCtxMenu = useCallback((type, id, e) => {
    e.preventDefault(); e.stopPropagation();
    doSelect(id);
    const items = [
      { id: "edit", icon: "✎",
        label: (type === "location" || type === "warehouse") ? "Rename (inline)" : "Edit in side panel",
        hotkey: (type === "location" || type === "warehouse") ? "dbl-click" : undefined,
        run: () => {
          if (type === "location" || type === "warehouse") {
            const n = data.nodes.find(x => x.id === id);
            if (n) setEditingLabel({ type, id, value: n.label });
          } else {
            doSelect(id);
          }
        }
      },
      { id: "duplicate", icon: "⎘", label: "Duplicate", hotkey: "Ctrl+D", run: () => duplicateItem(type, id) },
      ...(type === "location" ? [
        { divider: true },
        { id: "drill",  icon: "⌖", label: "Open sub-locations →", run: () => setDrillInto(id) },
      ] : []),
      { divider: true },
      { id: "front", icon: "⤒", label: "Bring to Front", hotkey: "Ctrl+]", run: () => zReorder("front") },
      { id: "fwd",   icon: "↑",  label: "Bring Forward", hotkey: "]",      run: () => zReorder("fwd")   },
      { id: "bwd",   icon: "↓",  label: "Send Backward", hotkey: "[",      run: () => zReorder("bwd")   },
      { id: "back",  icon: "⤓", label: "Send to Back",  hotkey: "Ctrl+[", run: () => zReorder("back")  },
      { divider: true },
      { id: "delete", icon: "✕", label: "Delete", hotkey: "Del", danger: true, run: () => doDelete(type, id) },
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [data.nodes, doSelect, duplicateItem, zReorder, doDelete]);

  const undo = useCallback(() => {
    setData(p => {
      if (historyRef.current.length === 0) return p;
      const prev = historyRef.current[historyRef.current.length - 1];
      historyRef.current = historyRef.current.slice(0, -1);
      futureRef.current = [p, ...futureRef.current.slice(0, 49)];
      setCanUndo(historyRef.current.length > 0);
      setCanRedo(true);
      return prev;
    });
    setSel(null);
  }, []);

  const redo = useCallback(() => {
    setData(p => {
      if (futureRef.current.length === 0) return p;
      const next = futureRef.current[0];
      futureRef.current = futureRef.current.slice(1);
      historyRef.current = [...historyRef.current.slice(-49), p];
      setCanUndo(true);
      setCanRedo(futureRef.current.length > 0);
      return next;
    });
    setSel(null);
  }, []);

  // Persist op-viz mode across reloads (viewing pref, not part of `data`)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('opVizMode');
      if (saved && ['pills', 'pills_wash', 'hidden'].includes(saved)) setOpVizMode(saved);
    } catch (_) { /* localStorage may be unavailable */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('opVizMode', opVizMode); } catch (_) { /* ignore */ }
  }, [opVizMode]);

  useEffect(() => {
    const handler = (e) => {
      // Ignore when typing in an input/textarea/select
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
      const cmd = e.ctrlKey || e.metaKey;
      if (cmd && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
      if (cmd && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); return; }
      // Z-order: ] / [ forward/backward, Ctrl+] / Ctrl+[ to front/back
      if (e.key === ']' && !cmd) { e.preventDefault(); zReorder("fwd"); return; }
      if (e.key === '[' && !cmd) { e.preventDefault(); zReorder("bwd"); return; }
      if (e.key === ']' && cmd)  { e.preventDefault(); zReorder("front"); return; }
      if (e.key === '[' && cmd)  { e.preventDefault(); zReorder("back"); return; }
      // Esc clears selection
      if (e.key === 'Escape') {
        if (drillInto) { setDrillInto(null); return; }
        setSel(null); setMultiSel(new Set()); setPutawayLoc(null); return;
      }
      // Del/Backspace deletes selected
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault(); doDelete(sel.type, sel.id); return;
      }
      // Arrow nudge: 8px, shift=1px (world coords)
      if (sel && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) {
        const node = data.nodes.find(n => n.id === sel.id);
        if (!node) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 8;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
        setData(p => ({ ...p, nodes: p.nodes.map(n => (multiSel.has(n.id) || n.id === sel.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n) }));
        return;
      }
      // F focuses selection in viewport
      if (e.key === 'f' && sel) {
        e.preventDefault();
        const n = data.nodes.find(x => x.id === sel.id);
        if (!n || !svgRef.current) return;
        const r = svgRef.current.getBoundingClientRect();
        setOffset({ x: r.width / 2 - (n.x + NW / 2) * scale, y: r.height / 2 - (n.y + NH / 2) * scale });
        return;
      }
      // Ctrl+A: select all visible nodes
      if (cmd && e.key === 'a') {
        e.preventDefault();
        setMultiSel(new Set(data.nodes.filter(n => !(hideUnused && n.type === "location" && !usedLocationIds.has(n.id))).map(n => n.id)));
        return;
      }
      // Ctrl+D / Cmd+D — duplicate selected
      if (cmd && (e.key === 'd' || e.key === 'D') && sel) {
        e.preventDefault(); duplicateItem(sel.type, sel.id); return;
      }
      // Ctrl+K / Cmd+K — command palette (also matches if Shift is held)
      if (cmd && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); e.stopPropagation(); setPaletteOpen(true); return;
      }
      // "/" anywhere outside an input — also opens palette (Linear/Slack-style)
      // NB: do NOT exclude e.shiftKey — on AZERTY/QWERTZ keyboards `/` is typed
      // with Shift held, so requiring !shiftKey would block half of Europe.
      if (e.key === '/' && !cmd && !e.altKey) {
        e.preventDefault(); e.stopPropagation(); setPaletteOpen(true); return;
      }
      // Ctrl+S / Cmd+S — Save (export JSON)
      if (cmd && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); e.stopPropagation();
        if (typeof handleExport === 'function') handleExport();
        return;
      }
      // Ctrl+O / Cmd+O — Open (import JSON)
      if (cmd && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault(); e.stopPropagation();
        importRef.current?.click();
        return;
      }
      // 1 / 2 / 3 — cycle op-viz mode (when no modifier and outside inputs)
      if (!cmd && !e.altKey && !e.shiftKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
        const modes = { '1': 'pills', '2': 'pills_wash', '3': 'hidden' };
        setOpVizMode(modes[e.key]);
        e.preventDefault();
        return;
      }
      // L — auto-layout
      if (!cmd && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        autoLayout();
        return;
      }
      // 0 — fit-to-content
      if (!cmd && e.key === '0') {
        e.preventDefault();
        fitToContent();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, zReorder, sel, multiSel, data.nodes, doDelete, scale, hideUnused, usedLocationIds, duplicateItem]);

  const autoLayout = useCallback(() => {
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);

      // ── Tunables ─────────────────────────────────────────────────────────
      const COL_W = 290;          // horizontal tier spacing
      const ROW_H = 100;          // vertical row spacing within a tier
      const DIAG_DROP = 55;       // vertical drift per tier (guarantees diagonal flow)
      const PAD_X = 80;             // canvas-edge padding (Y baseline comes from Y_CENTER below)
      const BC_ITER = 12;         // barycenter passes (Sugiyama crossing reduction)

      // ── Visibility filter ────────────────────────────────────────────────
      const usedIds = new Set();
      if (hideUnused) {
        for (const route of p.routes) for (const rule of route.rules) {
          if (rule.src_location_id) usedIds.add(rule.src_location_id);
          if (rule.dest_location_id) usedIds.add(rule.dest_location_id);
        }
        for (const pr of p.putawayRules) if (pr.location_in_id) usedIds.add(pr.location_in_id);
      }
      const flowNodes = p.nodes.filter(n => n.type === "location" && (!hideUnused || usedIds.has(n.id)));
      const warehouseNodes = p.nodes.filter(n => n.type === "warehouse");
      const nodeIds = new Set(flowNodes.map(n => n.id));

      // ── Usage classifiers ────────────────────────────────────────────────
      const usageMap = new Map(flowNodes.map(n => [n.id, n.data?.usage || ""]));
      const usage = id => usageMap.get(id) || "";
      const isSupplier  = id => usage(id) === "supplier";
      const isCustomer  = id => usage(id) === "customer";
      const isInventory = id => usage(id) === "inventory";
      const isView      = id => usage(id) === "view";

      // ── Route lane assignment ────────────────────────────────────────────
      // Each route gets a numeric laneRank. Negative = top, 0 = center axis,
      // positive = bottom. Routes that start at a supplier sit on top, routes
      // that end at a customer sit below center, manufacture goes far bottom,
      // and "post-receive" bypass routes (those starting at a location that
      // some other route fills from a supplier — like CrossDock starting at
      // Input) sit between top and center.
      //
      // Chain-start of a route = sources that aren't also destinations in the
      // same route's rule set. This handles routes-as-DAGs cleanly.
      const ruleAct = rl => rl.data?.action || rl.action || "";
      const suppliedLocs = new Set();
      for (const r of p.routes) for (const rl of r.rules) {
        if (isSupplier(rl.src_location_id)) suppliedLocs.add(rl.dest_location_id);
      }
      const routeStarts = route => {
        const srcs = new Set(route.rules.map(r => r.src_location_id));
        const dsts = new Set(route.rules.map(r => r.dest_location_id));
        return [...srcs].filter(s => !dsts.has(s));
      };
      const laneRankForRoute = route => {
        if (!route.rules.length) return 0;
        const acts = route.rules.map(ruleAct);
        if (acts.includes("manufacture")) return 100;
        if (acts.includes("buy"))         return -90;
        const starts = routeStarts(route);
        const endsCust = route.rules.some(r => isCustomer(r.dest_location_id));
        const startsSup = starts.some(isSupplier);
        if (startsSup && endsCust)                       return -50;
        if (startsSup)                                   return -100;
        if (starts.some(s => suppliedLocs.has(s)))       return endsCust ? -30 : 0;
        if (endsCust)                                    return 50;
        return 0;
      };
      const routeLane = new Map(p.routes.map(r => [r.id, laneRankForRoute(r)]));

      // ── Per-node lane resolution ─────────────────────────────────────────
      // A node's lane = the lane of routes that touch it. If routes span
      // multiple distinct lane buckets, the node sits on the center axis (0).
      // Nodes touched by no route fall back to usage-derived defaults so
      // op-only-driven layouts still group sensibly.
      const lanesByNode = new Map();
      for (const n of flowNodes) lanesByNode.set(n.id, new Set());
      for (const route of p.routes) {
        const lr = routeLane.get(route.id) ?? 0;
        for (const rule of route.rules) {
          if (lanesByNode.has(rule.src_location_id))  lanesByNode.get(rule.src_location_id).add(lr);
          if (lanesByNode.has(rule.dest_location_id)) lanesByNode.get(rule.dest_location_id).add(lr);
        }
      }
      const nodeLane = new Map();
      for (const n of flowNodes) {
        const ranks = [...lanesByNode.get(n.id)];
        if (ranks.length === 0) {
          const u = usage(n.id);
          nodeLane.set(n.id,
            u === "supplier"   ? -100 :
            u === "customer"   ?   50 :
            u === "production" ?  100 : 0);
        } else if (ranks.length === 1) {
          nodeLane.set(n.id, ranks[0]);
        } else {
          nodeLane.set(n.id, 0); // shared → center axis
        }
      }

      // Distinct ranks → integer slots around 0 (center). Closest-to-zero
      // ranks get slots ±1; farther ranks get ±2, etc. This keeps lane gap
      // constant regardless of how dense the lane spectrum is.
      const distinctRanks = [...new Set(nodeLane.values())];
      const negRanks = distinctRanks.filter(r => r < 0).sort((a, b) => b - a);
      const posRanks = distinctRanks.filter(r => r > 0).sort((a, b) => a - b);
      const rankToSlot = new Map([[0, 0]]);
      negRanks.forEach((r, i) => rankToSlot.set(r, -(i + 1)));
      posRanks.forEach((r, i) => rankToSlot.set(r, (i + 1)));

      // ── Build directed edges (deduped, pointing in flow direction) ───────
      const edgeSet = new Set();
      const addEdge = (s, d) => {
        if (!nodeIds.has(s) || !nodeIds.has(d) || s === d) return;
        if (isCustomer(s) || isSupplier(d)) return; // never against natural flow
        edgeSet.add(`${s}\t${d}`);
      };
      for (const route of p.routes) for (const rule of route.rules)
        addEdge(rule.src_location_id, rule.dest_location_id);
      for (const op of p.operationTypes)
        addEdge(op.src_location_id, op.dest_location_id);
      const edges = [...edgeSet].map(e => e.split("\t"));

      // ── Adjacency + cycle handling ───────────────────────────────────────
      // Real Odoo flows have cycles (e.g. Stock → Pre-Prod → Production → Stock
      // for manufacturing). A naive longest-path BFS would loop around the cycle
      // and inflate tier numbers without bound. Solution: classify back-edges
      // via iterative DFS and exclude them from tier / barycenter computation.
      // Edges still get rendered — they just don't drive layout.
      const adjFFull = {};
      for (const n of flowNodes) adjFFull[n.id] = [];
      for (const [s, d] of edges) adjFFull[s].push(d);

      const dfsVisited = new Set();
      const dfsOnStack = new Set();
      const backEdges = new Set();
      for (const startId of nodeIds) {
        if (dfsVisited.has(startId)) continue;
        const stk = [{ node: startId, edges: adjFFull[startId] || [], idx: 0 }];
        dfsVisited.add(startId); dfsOnStack.add(startId);
        while (stk.length) {
          const top = stk[stk.length - 1];
          if (top.idx >= top.edges.length) {
            dfsOnStack.delete(top.node); stk.pop(); continue;
          }
          const next = top.edges[top.idx++];
          if (dfsOnStack.has(next)) {
            backEdges.add(`${top.node}\t${next}`);
          } else if (!dfsVisited.has(next)) {
            dfsVisited.add(next); dfsOnStack.add(next);
            stk.push({ node: next, edges: adjFFull[next] || [], idx: 0 });
          }
        }
      }

      const adjF = {}, adjB = {};
      for (const n of flowNodes) { adjF[n.id] = []; adjB[n.id] = []; }
      for (const [s, d] of edges) {
        if (backEdges.has(`${s}\t${d}`)) continue;
        adjF[s].push(d); adjB[d].push(s);
      }

      // ── Tier assignment via longest-path BFS from sources ────────────────
      // Sources: suppliers and any node with no incoming edges.
      const tier = {};
      const seeds = flowNodes.filter(n => isSupplier(n.id) || adjB[n.id].length === 0);
      const q = seeds.map(n => n.id);
      for (const id of q) tier[id] = isSupplier(id) ? 0 : 1;
      for (let qi = 0; qi < q.length && qi < 50000; qi++) {
        const cur = q[qi];
        for (const next of adjF[cur]) {
          if (isCustomer(next)) continue;
          const nd = tier[cur] + 1;
          if (tier[next] === undefined || tier[next] < nd) {
            tier[next] = nd; q.push(next);
          }
        }
      }
      for (const n of flowNodes) if (tier[n.id] === undefined) tier[n.id] = 1;

      // Force customers to maxTier+1 and inventory loss to its own far-right column
      const mainMax = Math.max(0, ...flowNodes
        .filter(n => !isCustomer(n.id) && !isInventory(n.id))
        .map(n => tier[n.id]));
      for (const n of flowNodes) {
        if (isCustomer(n.id))  tier[n.id] = mainMax + 1;
        if (isInventory(n.id)) tier[n.id] = mainMax + 1;
      }

      // Group into per-tier ordered lists. Initial order = current y so user-tweaked
      // positions are preserved when re-laying out.
      const byTier = new Map();
      for (const n of flowNodes) {
        const t = tier[n.id];
        if (!byTier.has(t)) byTier.set(t, []);
        byTier.get(t).push(n.id);
      }
      const yOf = id => flowNodes.find(n => n.id === id)?.y ?? 0;
      for (const ids of byTier.values()) ids.sort((a, b) => yOf(a) - yOf(b));

      // ── Barycenter crossing reduction (Sugiyama) ─────────────────────────
      // Alternate down- and up-passes; in each, reorder a tier so each node's
      // average-neighbor-rank in the previous tier is monotone.
      const tiers = [...byTier.keys()].sort((a, b) => a - b);
      const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      for (let pass = 0; pass < BC_ITER; pass++) {
        const goingDown = pass % 2 === 0;
        const order = goingDown ? tiers : [...tiers].reverse();
        for (let i = 1; i < order.length; i++) {
          const t = order[i];
          const ids = byTier.get(t);
          const refIds = byTier.get(order[i - 1]) || [];
          const refRank = new Map(refIds.map((id, idx) => [id, idx]));
          const score = id => {
            const neigh = goingDown ? adjB[id] : adjF[id];
            const ranks = neigh.map(n => refRank.get(n)).filter(v => v !== undefined);
            return avg(ranks);
          };
          ids.sort((a, b) => score(a) - score(b) || yOf(a) - yOf(b));
        }
      }

      // ── Position assignment by lane ──────────────────────────────────────
      // X = tier-based (unchanged). Y = lane-based: each lane has a global
      // y-center; nodes in a lane stack symmetrically around that y.
      //
      // Linear-chain fallback: when every tier has exactly one node and all
      // nodes share the center lane, lanes provide no vertical structure —
      // fall back to the legacy diagonal drift so the chain doesn't collapse
      // into a flat line.
      const Y_CENTER = 400;
      const LANE_GAP = 110;
      const laneY = rank => Y_CENTER + (rankToSlot.get(rank) ?? 0) * LANE_GAP;
      const isLinear = tiers.every(t => byTier.get(t).length === 1) &&
                       [...nodeLane.values()].every(r => r === 0);

      const pos = {};
      for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i];
        const ids = byTier.get(t);
        const x = PAD_X + (t - tiers[0]) * COL_W;

        if (isLinear) {
          const baseline = Y_CENTER - 100 + i * DIAG_DROP;
          ids.forEach((id, j) => { pos[id] = { x, y: baseline + j * ROW_H }; });
          continue;
        }

        // Group by lane within this tier
        const byLane = new Map();
        for (const id of ids) {
          const r = nodeLane.get(id) ?? 0;
          if (!byLane.has(r)) byLane.set(r, []);
          byLane.get(r).push(id);
        }
        // Stack each lane's nodes around the lane's y-center, sub-sorted by
        // the barycenter-derived order in `ids` (which we preserve via push order).
        for (const [rank, laneIds] of byLane.entries()) {
          const ly = laneY(rank);
          const m = laneIds.length;
          laneIds.forEach((id, k) => {
            pos[id] = { x, y: ly - (m - 1) * ROW_H / 2 + k * ROW_H };
          });
        }
      }

      // ── Inventory anchor ─────────────────────────────────────────────────
      // Suppliers and customers already sit in their lane's y from the lane
      // pass above. Inventory-loss locations are orthogonal to flow and pin
      // to the bottom of the canvas regardless.
      const yBottom = Math.max(Y_CENTER, ...flowNodes.map(n => pos[n.id]?.y ?? Y_CENTER));
      const invList = flowNodes.filter(n => isInventory(n.id));
      invList.forEach((n, k) => { pos[n.id].y = yBottom + 200 + k * ROW_H; });
      // Last sanity: ensure no two nodes overlap (anywhere on the canvas, post-anchor)
      const positioned = [...nodeIds].map(id => ({ id, ...pos[id] }));
      const minGap = 90;
      // Group by approximate column (x within ±20 = same tier visually)
      const byX = new Map();
      for (const item of positioned) {
        const key = Math.round(item.x / 10) * 10;
        if (!byX.has(key)) byX.set(key, []);
        byX.get(key).push(item);
      }
      for (const arr of byX.values()) {
        arr.sort((a, b) => a.y - b.y);
        for (let k = 1; k < arr.length; k++) {
          if (arr[k].y < arr[k - 1].y + minGap) {
            arr[k].y = arr[k - 1].y + minGap;
            pos[arr[k].id].y = arr[k].y;
          }
        }
      }

      // ── Warehouses: nudged onto a tag-friendly position ──────────────────
      // Each warehouse anchors above-left of its child cluster (so its name-tag
      // doesn't collide with op-type labels that auto-place on top).
      const newPos = { ...pos };
      warehouseNodes.forEach((wh, i) => {
        const code = wh.data?.code || wh.label || "";
        const childIds = flowNodes.filter(n => {
          const cn = n.data?.complete_name || n.label || "";
          return cn === code || cn.startsWith(code + "/");
        }).map(n => n.id);
        if (childIds.length === 0) {
          newPos[wh.id] = { x: PAD_X + i * COL_W, y: 20 };
          return;
        }
        const minX = Math.min(...childIds.map(id => pos[id].x));
        const minY = Math.min(...childIds.map(id => pos[id].y));
        // Place the warehouse a hair above the cluster (the blob auto-fits anyway)
        newPos[wh.id] = { x: minX, y: minY - 90 };
      });

      // ── Auto-place op-type labels ────────────────────────────────────────
      // For each op-type, anchor the label near *one of its endpoint nodes*
      // (so the leader line is short on wide blobs), then try 8 candidate
      // positions around that anchor. Pick the lowest collision score.
      // Renderer is matched: when labelDx/Dy is non-zero, the label uses the
      // op's own blob.minY as its anchor (no cluster stacking offset).
      const opPositions = []; // [{ id, blob, label, edge: {x1,y1,x2,y2} }]
      // Pre-compute every blob bbox once so labels can avoid all of them.
      const allBlobs = [];
      for (const o of p.operationTypes) {
        const s = newPos[o.src_location_id], d = newPos[o.dest_location_id];
        if (!s || !d) continue;
        allBlobs.push({
          minX: Math.min(s.x, d.x) - 30,
          minY: Math.min(s.y, d.y) - 30,
          maxX: Math.max(s.x + NW, d.x + NW) + 30,
          maxY: Math.max(s.y + NH, d.y + NH) + 30,
          edge: { x1: s.x + NW / 2, y1: s.y + NH / 2, x2: d.x + NW / 2, y2: d.y + NH / 2 },
        });
      }

      const LW = 150, LH = 20, OFF = 20;
      // Place labels in tier-then-y order: ops in the leftmost / topmost
      // dense areas get first pick of clean space, so later ops with more
      // breathing room work around them. Cuts long leader lines.
      const opTier = op => tier[op.src_location_id] ?? 999;
      const opY    = op => newPos[op.src_location_id]?.y ?? 0;
      const placementOrder = [...p.operationTypes].sort((a, b) => {
        const dt = opTier(a) - opTier(b);
        return dt !== 0 ? dt : opY(a) - opY(b);
      });
      const placedById = new Map();
      for (const op of placementOrder) {
        const sn = newPos[op.src_location_id], dn = newPos[op.dest_location_id];
        if (!sn || !dn) { placedById.set(op.id, op); continue; }
        const blob = {
          minX: Math.min(sn.x, dn.x) - 30,
          minY: Math.min(sn.y, dn.y) - 30,
          maxX: Math.max(sn.x + NW, dn.x + NW) + 30,
          maxY: Math.max(sn.y + NH, dn.y + NH) + 30,
        };
        // Anchor candidates near each endpoint AND at midpoint, so wide blobs
        // don't fling labels into the centre of empty space.
        const anchors = [
          { ax: sn.x + NW / 2, ay: sn.y + NH / 2 },                        // src
          { ax: dn.x + NW / 2, ay: dn.y + NH / 2 },                        // dst
          { ax: (sn.x + dn.x + NW) / 2, ay: (sn.y + dn.y + NH) / 2 },      // mid
        ];
        // Around each anchor, generate compact 8-direction candidates
        const directions = [
          [ 0, -1], [ 1, -1], [ 1, 0], [ 1, 1],
          [ 0,  1], [-1,  1], [-1, 0], [-1,-1],
        ];
        const candidates = [];
        for (const { ax, ay } of anchors) {
          for (const [ux, uy] of directions) {
            const dist = 80;
            const x = ax + ux * dist - LW / 2;
            const y = ay + uy * dist - LH / 2;
            candidates.push({ x, y });
          }
        }
        // Plus a few cardinal positions outside the blob (for ops whose blob is small)
        candidates.push({ x: (blob.minX + blob.maxX) / 2 - LW / 2, y: blob.minY - OFF - LH }); // N of blob
        candidates.push({ x: (blob.minX + blob.maxX) / 2 - LW / 2, y: blob.maxY + OFF });      // S of blob

        // Distance helper: line-rect overlap test (approximate via segment-rect intersection)
        const segRectHits = (x1, y1, x2, y2, r) => {
          // Quick reject
          if (Math.max(x1, x2) < r.x0 || Math.min(x1, x2) > r.x1) return false;
          if (Math.max(y1, y2) < r.y0 || Math.min(y1, y2) > r.y1) return false;
          // Check 4 rect-edge intersections via parametric form
          const segIntersect = (ax, ay, bx, by, cx, cy, dx, dy) => {
            const denom = (ax - bx) * (cy - dy) - (ay - by) * (cx - dx);
            if (denom === 0) return false;
            const t = ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / denom;
            const u = -((ax - bx) * (ay - cy) - (ay - by) * (ax - cx)) / denom;
            return t >= 0 && t <= 1 && u >= 0 && u <= 1;
          };
          return segIntersect(x1, y1, x2, y2, r.x0, r.y0, r.x1, r.y0) ||
                 segIntersect(x1, y1, x2, y2, r.x1, r.y0, r.x1, r.y1) ||
                 segIntersect(x1, y1, x2, y2, r.x1, r.y1, r.x0, r.y1) ||
                 segIntersect(x1, y1, x2, y2, r.x0, r.y1, r.x0, r.y0);
        };

        const score = (c) => {
          let s = 0;
          const labelR = { x0: c.x, y0: c.y, x1: c.x + LW, y1: c.y + LH };
          // Distance from blob center (prefer close)
          const bx = (blob.minX + blob.maxX) / 2, by = (blob.minY + blob.maxY) / 2;
          const labelCx = c.x + LW / 2, labelCy = c.y + LH / 2;
          s += Math.hypot(labelCx - bx, labelCy - by) * 0.05;
          // Penalty: overlap with other blobs (skip own blob)
          for (let i = 0; i < allBlobs.length; i++) {
            const o = allBlobs[i];
            if (o === blob) continue;
            if (!(labelR.x1 < o.minX || labelR.x0 > o.maxX || labelR.y1 < o.minY || labelR.y0 > o.maxY)) s += 80;
            // Penalty: label crosses an edge (line from src→dst of another op)
            if (segRectHits(o.edge.x1, o.edge.y1, o.edge.x2, o.edge.y2, labelR)) s += 40;
          }
          // Penalty: overlap with already-placed labels
          for (const placed of opPositions) {
            const o = placed.label;
            if (!(labelR.x1 < o.x || labelR.x0 > o.x + o.w || labelR.y1 < o.y || labelR.y0 > o.y + o.h)) s += 200;
          }
          // Penalty: too close to a flow node (overlap with leaf rect)
          for (const n of flowNodes) {
            const np = newPos[n.id];
            if (!np) continue;
            const nodeR = { x0: np.x, y0: np.y, x1: np.x + NW, y1: np.y + NH };
            if (!(labelR.x1 < nodeR.x0 || labelR.x0 > nodeR.x1 || labelR.y1 < nodeR.y0 || labelR.y0 > nodeR.y1)) s += 150;
          }
          return s;
        };

        let best = candidates[0], bestS = Infinity;
        for (const c of candidates) {
          const sc = score(c);
          if (sc < bestS) { bestS = sc; best = c; }
        }
        // Renderer uses (b.minX + 6, b.minY - 14) as anchor when labelDx/Dy != 0,
        // so compute the offset from that anchor.
        const labelDx = Math.round(best.x - (blob.minX + 6));
        const labelDy = Math.round(best.y - (blob.minY - 14));
        opPositions.push({ id: op.id, blob, label: { x: best.x, y: best.y, w: LW, h: LH } });
        placedById.set(op.id, { ...op, labelDx, labelDy });
      }
      // Rebuild operationTypes in original array order so consumers (sidebar,
      // export JSON, etc.) see a stable order independent of placement order.
      const newOps = p.operationTypes.map(op => placedById.get(op.id) || op);

      return {
        ...p,
        nodes: p.nodes.map(n => newPos[n.id] ? { ...n, ...newPos[n.id] } : n),
        operationTypes: newOps,
      };
    });
  }, [hideUnused]);

  const fitToContent = useCallback(() => {
    if (!svgRef.current) return;
    const visible = data.nodes.filter(n => !(hideUnused && n.type === "location" && !usedLocationIds.has(n.id)));
    if (visible.length === 0) return;
    const PAD = 40;
    const minX = Math.min(...visible.map(n => n.x));
    const minY = Math.min(...visible.map(n => n.y));
    const maxX = Math.max(...visible.map(n => n.x + NW));
    const maxY = Math.max(...visible.map(n => n.y + NH));
    const r = svgRef.current.getBoundingClientRect();
    const vw = r.width, vh = r.height;
    const contentW = maxX - minX, contentH = maxY - minY;
    const ns = Math.min(Math.max((vw - PAD * 2) / contentW, 0.2), (vh - PAD * 2) / contentH, 3);
    setScale(ns);
    setOffset({ x: PAD - minX * ns, y: PAD - minY * ns });
  }, [data.nodes, hideUnused, usedLocationIds]);

  // Auto-layout + fit when hideUnused toggles
  const hideUnusedRef = useRef(hideUnused);
  useEffect(() => {
    if (hideUnusedRef.current !== hideUnused) {
      hideUnusedRef.current = hideUnused;
      autoLayout();
      setTimeout(() => fitToContent(), 50);
    }
  }, [hideUnused, autoLayout, fitToContent]);

  const mergeWizardOutput = useCallback((input) => {
    const out = presetGenerator(input);
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      return {
        ...p,
        nodes: [...p.nodes, ...out.addNodes],
        operationTypes: [...p.operationTypes, ...out.addOperationTypes],
        routes: [...p.routes, ...out.addRoutes],
      };
    });
    setTimeout(() => { autoLayout(); fitToContent(); }, 50);
  }, [autoLayout, fitToContent]);

  // Plan B: when an edit on a wizard-managed warehouse flag is detected,
  // either apply directly (pure grow) or stage a confirmation dialog.
  // Returns true if the edit was intercepted (caller should NOT call doUpdate).
  const tryWarehouseFlagEdit = useCallback((warehouseId, fieldKey, newValue) => {
    const wh = data.nodes.find(n => n.type === 'warehouse' && n.id === warehouseId);
    if (!wh) return false;
    const currentFlags = wh.data || {};
    const newFlags = {
      reception_steps: currentFlags.reception_steps || 'one_step',
      delivery_steps: currentFlags.delivery_steps || 'ship_only',
      manufacture_to_resupply: !!currentFlags.manufacture_to_resupply,
      manufacture_steps: currentFlags.manufacture_steps || 'mrp_one_step',
      buy_to_resupply: !!currentFlags.buy_to_resupply,
      resupply_wh_ids: Array.isArray(currentFlags.resupply_wh_ids) ? currentFlags.resupply_wh_ids : [],
      [fieldKey]: newValue,
    };
    const diff = presetDiff(data, warehouseId, newFlags, currentFlags.code || 'WH', wh.label || currentFlags.name || 'Warehouse');
    const nothingToRemove =
      diff.toRemove.nodeIds.length === 0 &&
      diff.toRemove.opTypeIds.length === 0 &&
      diff.toRemove.routeIds.length === 0;
    if (nothingToRemove) {
      // Pure grow: apply directly (with undo)
      setData(p => {
        historyRef.current = [...historyRef.current.slice(-49), p];
        futureRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
        const updatedNodes = p.nodes.map(n =>
          n.id === warehouseId ? { ...n, data: { ...n.data, [fieldKey]: newValue } } : n);
        return {
          ...p,
          nodes: [...updatedNodes, ...diff.toAdd.nodes],
          operationTypes: [...p.operationTypes, ...diff.toAdd.operationTypes],
          routes: [...p.routes, ...diff.toAdd.routes],
        };
      });
      setTimeout(() => { autoLayout(); fitToContent(); }, 50);
      return true;
    }
    // Shrink path: stage confirmation
    setShrinkPending({
      diff,
      warehouse: wh,
      fieldLabel: fieldKey,
      oldValue: currentFlags[fieldKey],
      newValue,
      warehouseId,
      fieldKey,
    });
    return true;
  }, [data, autoLayout, fitToContent]);

  const applyShrinkResolve = useCallback((mode) => {
    if (!shrinkPending) return;
    const { diff, warehouseId, fieldKey, newValue } = shrinkPending;
    const removeNodes = new Set(diff.toRemove.nodeIds);
    const removeOps = new Set(diff.toRemove.opTypeIds);
    const removeRoutes = new Set(diff.toRemove.routeIds);
    const removePutaway = new Set(diff.toRemove.putawayRuleIds);
    setData(p => {
      historyRef.current = [...historyRef.current.slice(-49), p];
      futureRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      const flagPatch = (n) => n.id === warehouseId
        ? { ...n, data: { ...n.data, [fieldKey]: newValue } }
        : n;
      if (mode === 'delete') {
        return {
          ...p,
          nodes: p.nodes.filter(n => !removeNodes.has(n.id)).map(flagPatch).concat(diff.toAdd.nodes),
          operationTypes: p.operationTypes.filter(o => !removeOps.has(o.id)).concat(diff.toAdd.operationTypes),
          routes: p.routes.filter(rt => !removeRoutes.has(rt.id)).concat(diff.toAdd.routes),
          putawayRules: (p.putawayRules || []).filter(pr => !removePutaway.has(pr.id)),
        };
      }
      // 'deactivate' — flag entities as inactive but keep them
      const markInactive = (e) => ({
        ...e,
        data: { ...e.data, active: false },
        __autoGen: { ...(e.__autoGen || {}), deactivated: true },
      });
      return {
        ...p,
        nodes: p.nodes.map(n => removeNodes.has(n.id) ? markInactive(n) : flagPatch(n)).concat(diff.toAdd.nodes),
        operationTypes: p.operationTypes.map(o => removeOps.has(o.id) ? markInactive(o) : o).concat(diff.toAdd.operationTypes),
        routes: p.routes.map(rt => removeRoutes.has(rt.id) ? markInactive(rt) : rt).concat(diff.toAdd.routes),
      };
    });
    setShrinkPending(null);
    setTimeout(() => { autoLayout(); fitToContent(); }, 50);
  }, [shrinkPending, autoLayout, fitToContent]);

  const handleFetchFromOdoo = useCallback(async () => {
    if (!apiCfg.url || !apiCfg.db || !apiCfg.username || !apiCfg.apiKey) {
      setShowCfg(true); // prompt user to fill in credentials
      return;
    }
    setFetchStatus({ loading: true, progress: "Connecting…" });
    try {
      const result = await fetchInventoryFromOdoo(apiCfg, msg => setFetchStatus({ loading: true, progress: msg }));
      const fetched = backfillSequences(result.data);
      // Push current data to history so fetch is undoable
      setData(prev => {
        historyRef.current = [...historyRef.current.slice(-49), prev];
        futureRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
        return fetched;
      });
      // Save snapshot for diffing + session context for write-back
      setFetchedSnapshot(JSON.parse(JSON.stringify(fetched)));
      setOdooCtx(result.userContext);
      setSel(null);
      setFetchStatus({ ok: true });
      // Auto-layout after a tick so state has settled
      setTimeout(() => {
        autoLayout();
        fitToContent();
        setFetchStatus(null);
      }, 100);
    } catch (err) {
      setFetchStatus({ error: err.message || "Unknown error" });
    }
  }, [apiCfg, autoLayout, fitToContent]);

  // In Konu mode, auto-fetch on mount — credentials are server-side
  const didAutoFetchRef = useRef(false);
  useEffect(() => {
    if (KONU_CFG && KONU_CFG.konuMode && !didAutoFetchRef.current) {
      didAutoFetchRef.current = true;
      handleFetchFromOdoo();
    }
  }, [handleFetchFromOdoo]);

  // ─── Pan / drag with Miro-style polish ────────────────────────────────────
  // - 4px threshold before a drag is committed (so click-to-select doesn't nudge)
  // - Spacebar holds "force pan" mode (released → back to select)
  // - Selection only clears on bg *click* (down + up with no drag), not bg-down
  // - mousemove handlers are RAF-throttled so heavy diagrams stay fluid
  const dragThresholdRef = useRef(false);   // true once threshold passed
  const downPosRef = useRef(null);          // {x,y} clientPos at mousedown
  const rafPendingRef = useRef(null);       // pending RAF event for throttling
  const [spaceDown, setSpaceDown] = useState(false);
  const [hoverId, setHoverId] = useState(null);
  const [editingLabel, setEditingLabel] = useState(null); // { type, id, value }
  const [lasso, setLasso] = useState(null); // { x0, y0, x1, y1 } in screen coords
  const [connect, setConnect] = useState(null); // { srcId, srcSide, mx, my } drag-from-port
  const [snapGuides, setSnapGuides] = useState([]); // [{ orient: 'v'|'h', pos }]
  const [placement, setPlacement] = useState(null); // { type } — pending placement
  const [placeMouse, setPlaceMouse] = useState(null); // {x,y} client coords for ghost
  const [connectTarget, setConnectTarget] = useState(null); // {srcId,dstId} — opens RouteFor­NewRule modal
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, items }
  const [helpOpen, setHelpOpen] = useState(false);

  // Track cursor while in placement mode (for the ghost-tile preview)
  useEffect(() => {
    if (!placement) { setPlaceMouse(null); return; }
    const handler = (e) => setPlaceMouse({ x: e.clientX, y: e.clientY });
    const escHandler = (e) => { if (e.key === "Escape") setPlacement(null); };
    window.addEventListener("mousemove", handler);
    window.addEventListener("keydown", escHandler);
    return () => {
      window.removeEventListener("mousemove", handler);
      window.removeEventListener("keydown", escHandler);
    };
  }, [placement]);

  // Spacebar = force-pan mode (cursor: grab, bg drag pans regardless)
  useEffect(() => {
    const dn = e => {
      if (e.code === "Space" && !e.repeat) {
        const tag = (e.target?.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
        e.preventDefault(); setSpaceDown(true);
      }
    };
    const up = e => { if (e.code === "Space") setSpaceDown(false); };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, []);

  const onCanvasDown = useCallback((e) => {
    // Anywhere-pan: Alt+drag (or middle mouse button) starts a pan, even on top of a node.
    // This lets the user move the canvas without having to find empty background space.
    if (e.altKey || e.button === 1) {
      e.preventDefault();
      setIsPan(true);
      setPanSt({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      downPosRef.current = { x: e.clientX, y: e.clientY, kind: "bg" };
      dragThresholdRef.current = false;
      return;
    }
    if (e.target === svgRef.current || e.target.getAttribute("data-bg")) {
      // Placement mode: place node at click and exit mode
      if (placement) {
        const r = svgRef.current.getBoundingClientRect();
        const wx = (e.clientX - r.left - offset.x) / scale;
        const wy = (e.clientY - r.top - offset.y) / scale;
        doAdd(placement.type, { x: wx - NW / 2, y: wy - NH / 2 });
        setPlacement(null);
        return;
      }
      // Shift+drag from bg = lasso
      if (e.shiftKey) {
        setLasso({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
        downPosRef.current = { x: e.clientX, y: e.clientY, kind: "lasso" };
        dragThresholdRef.current = false;
        return;
      }
      setIsPan(true);
      setPanSt({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      downPosRef.current = { x: e.clientX, y: e.clientY, kind: "bg" };
      dragThresholdRef.current = false;
      // NB: we do NOT clear selection here. That happens on bg *click* (mouseup with no drag)
    }
  }, [offset, scale, placement]);

  const onDragStart = useCallback((id, e, type, isMulti) => {
    setDragId(id); setDragT(type);
    downPosRef.current = { x: e.clientX, y: e.clientY, kind: "node" };
    dragThresholdRef.current = false;
    if (type === "node") {
      if (isMulti) {
        setDragOff({ x: e.clientX, y: e.clientY });
        setDragGroup(null);
      } else {
        const nd = data.nodes.find(n => n.id === id);
        if (nd) setDragOff({ x: e.clientX - (nd.x * scale + offset.x), y: e.clientY - (nd.y * scale + offset.y) });
        // Warehouse-as-group drag: capture child locations so the whole warehouse
        // (and any op-type blobs anchored to those locations) move rigidly together.
        if (nd && nd.type === "warehouse") {
          const code = nd.data?.code || nd.label || "";
          const isChild = (n) => n.type === "location" && (
            (code && (n.data?.complete_name === code)) ||
            (code && (n.data?.complete_name || "").startsWith(code + "/")) ||
            (n.__autoGen?.warehouseId === nd.id)
          );
          const members = data.nodes
            .filter(isChild)
            .map(n => ({ id: n.id, x0: n.x, y0: n.y }));
          // Include the warehouse itself so the delta is applied uniformly.
          members.push({ id: nd.id, x0: nd.x, y0: nd.y });
          setDragGroup({ warehouseId: nd.id, anchorX0: nd.x, anchorY0: nd.y, members });
        } else {
          setDragGroup(null);
        }
      }
    } else { setDragOff({ x: e.clientX, y: e.clientY }); setDragGroup(null); }
  }, [data.nodes, scale, offset]);

  // Heavy work: applies drag movement. Runs on RAF, not directly on mousemove.
  const applyMove = useCallback((e) => {
    if (isPan) setOffset({ x: e.clientX - panSt.x, y: e.clientY - panSt.y });
    if (lasso) { setLasso(l => ({ ...l, x1: e.clientX, y1: e.clientY })); return; }
    if (connect) { setConnect(c => ({ ...c, mx: e.clientX, my: e.clientY })); return; }
    if (!dragId) return;
    // Drag threshold — don't actually move until cursor has travelled >4px
    if (!dragThresholdRef.current && downPosRef.current) {
      const dx0 = e.clientX - downPosRef.current.x;
      const dy0 = e.clientY - downPosRef.current.y;
      if (dx0 * dx0 + dy0 * dy0 < 16) return; // 4px squared
      dragThresholdRef.current = true;
    }
    if (dragT === "node") {
      if (multiSel.has(dragId) && multiSel.size > 1) {
        const dx = (e.clientX - dragOff.x) / scale, dy = (e.clientY - dragOff.y) / scale;
        setDragOff({ x: e.clientX, y: e.clientY });
        setData(p => ({ ...p, nodes: p.nodes.map(n => multiSel.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n) }));
      } else if (dragGroup && dragGroup.warehouseId === dragId) {
        // Warehouse-as-group: apply mouse delta uniformly to every member.
        // Snap-guides are skipped for group drag — keeps children rigid relative to the warehouse.
        const newWhX = (e.clientX - dragOff.x - offset.x) / scale;
        const newWhY = (e.clientY - dragOff.y - offset.y) / scale;
        const dx = newWhX - dragGroup.anchorX0;
        const dy = newWhY - dragGroup.anchorY0;
        setSnapGuides([]);
        setData(p => {
          const memberMap = new Map(dragGroup.members.map(m => [m.id, m]));
          return { ...p, nodes: p.nodes.map(n => {
            const m = memberMap.get(n.id);
            return m ? { ...n, x: m.x0 + dx, y: m.y0 + dy } : n;
          }) };
        });
      } else {
        let nx = (e.clientX - dragOff.x - offset.x) / scale;
        let ny = (e.clientY - dragOff.y - offset.y) / scale;
        // Snap & alignment guides — snap to other nodes' x / x+W/2 / x+W (and same for y)
        const TH = 4; // world units
        const myXs = [nx, nx + NW / 2, nx + NW];
        const myYs = [ny, ny + NH / 2, ny + NH];
        const guides = [];
        let snapDx = 0, snapDy = 0, bestDx = TH + 1, bestDy = TH + 1;
        for (const o of data.nodes) {
          if (o.id === dragId) continue;
          const oXs = [o.x, o.x + NW / 2, o.x + NW];
          const oYs = [o.y, o.y + NH / 2, o.y + NH];
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
            const dx = oXs[j] - myXs[i];
            if (Math.abs(dx) < TH) {
              if (Math.abs(dx) < bestDx) { bestDx = Math.abs(dx); snapDx = dx; }
              guides.push({ orient: "v", pos: oXs[j] * scale + offset.x });
            }
            const dy = oYs[j] - myYs[i];
            if (Math.abs(dy) < TH) {
              if (Math.abs(dy) < bestDy) { bestDy = Math.abs(dy); snapDy = dy; }
              guides.push({ orient: "h", pos: oYs[j] * scale + offset.y });
            }
          }
        }
        nx += snapDx; ny += snapDy;
        setSnapGuides(guides.slice(0, 6)); // cap so render stays light
        setData(p => ({ ...p, nodes: p.nodes.map(n => n.id === dragId ? { ...n, x: nx, y: ny } : n) }));
      }
    }
    if (dragT === "group") {
      const dx = (e.clientX - dragOff.x) / scale, dy = (e.clientY - dragOff.y) / scale;
      setDragOff({ x: e.clientX, y: e.clientY });
      setData(p => {
        const op = p.operationTypes.find(o => o.id === dragId);
        if (!op) return p;
        const ids = new Set([op.src_location_id, op.dest_location_id]);
        return { ...p, nodes: p.nodes.map(n => ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n) };
      });
    }
    if (dragT === "oplabel") {
      const dx = (e.clientX - dragOff.x) / scale, dy = (e.clientY - dragOff.y) / scale;
      setDragOff({ x: e.clientX, y: e.clientY });
      setData(p => ({
        ...p,
        operationTypes: p.operationTypes.map(o => o.id === dragId
          ? { ...o, labelDx: (o.labelDx || 0) + dx, labelDy: (o.labelDy || 0) + dy }
          : o),
      }));
    }
  }, [isPan, panSt, dragId, dragT, dragOff, dragGroup, offset, scale, multiSel, lasso, connect, data.nodes]);

  // RAF-throttle mousemove so very fast cursors don't queue dozens of setData calls
  const onMove = useCallback((e) => {
    // Capture only the values React's synthetic event will lose post-RAF
    const snap = { clientX: e.clientX, clientY: e.clientY };
    if (rafPendingRef.current) return;
    rafPendingRef.current = requestAnimationFrame(() => {
      rafPendingRef.current = null;
      applyMove(snap);
    });
  }, [applyMove]);

  const onUp = useCallback((e) => {
    // bg-click without drag = clear selection
    if (isPan && !dragThresholdRef.current && downPosRef.current?.kind === "bg") {
      setSel(null); setMultiSel(new Set());
    }
    // Lasso finalize: any node whose AABB intersects the lasso joins multiSel
    if (lasso) {
      const r = svgRef.current?.getBoundingClientRect();
      if (r) {
        const lx = Math.min(lasso.x0, lasso.x1) - r.left;
        const ly = Math.min(lasso.y0, lasso.y1) - r.top;
        const lw = Math.abs(lasso.x1 - lasso.x0), lh = Math.abs(lasso.y1 - lasso.y0);
        if (lw > 4 || lh > 4) {
          const hits = new Set();
          for (const n of data.nodes) {
            if (hideUnused && n.type === "location" && !usedLocationIds.has(n.id)) continue;
            const nx = n.x * scale + offset.x;
            const ny = n.y * scale + offset.y;
            const nw = NW * scale, nh = NH * scale;
            if (nx + nw < lx || nx > lx + lw) continue;
            if (ny + nh < ly || ny > ly + lh) continue;
            hits.add(n.id);
          }
          setMultiSel(hits);
          if (hits.size > 0) setSel(null);
        }
      }
      setLasso(null);
    }
    // Connect finalize: detect target node under cursor — open rule-create modal
    if (connect) {
      const r = svgRef.current?.getBoundingClientRect();
      if (r) {
        const cx = e?.clientX, cy = e?.clientY;
        let target = null;
        if (cx !== undefined) {
          for (const n of data.nodes) {
            if (n.type !== "location") continue;
            if (n.id === connect.srcId) continue;
            if (hideUnused && !usedLocationIds.has(n.id)) continue;
            const nx = n.x * scale + offset.x + r.left;
            const ny = n.y * scale + offset.y + r.top;
            const nw = NW * scale, nh = NH * scale;
            if (cx >= nx && cx <= nx + nw && cy >= ny && cy <= ny + nh) { target = n; break; }
          }
        }
        if (target) {
          setConnectTarget({ srcId: connect.srcId, dstId: target.id });
        }
      }
      setConnect(null);
    }
    setIsPan(false); setDragId(null); setDragT(null);
    setDragGroup(null);
    setSnapGuides([]);
    dragThresholdRef.current = false;
    downPosRef.current = null;
    if (rafPendingRef.current) { cancelAnimationFrame(rafPendingRef.current); rafPendingRef.current = null; }
  }, [isPan, lasso, connect, data.nodes, hideUnused, usedLocationIds, scale, offset]);

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

  // When a route is selected, compute which nodes & rules belong to it for highlighting
  const routeHighlight = useMemo(() => {
    if (!sel) return null;
    const nodeIds = new Set();
    const ruleIds = new Set();
    const opIds = new Set();
    if (sel.type === "route") {
      const route = data.routes.find(r => r.id === sel.id);
      if (!route) return null;
      for (const rule of route.rules) {
        ruleIds.add(rule.id);
        if (rule.src_location_id) nodeIds.add(rule.src_location_id);
        if (rule.dest_location_id) nodeIds.add(rule.dest_location_id);
        if (rule.picking_type_id) opIds.add(rule.picking_type_id);
      }
    } else if (sel.type === "rule") {
      // Find the rule + its parent route to highlight just that line.
      for (const r of data.routes) {
        const rule = r.rules.find(rl => rl.id === sel.id);
        if (rule) {
          ruleIds.add(rule.id);
          if (rule.src_location_id) nodeIds.add(rule.src_location_id);
          if (rule.dest_location_id) nodeIds.add(rule.dest_location_id);
          if (rule.picking_type_id) opIds.add(rule.picking_type_id);
          break;
        }
      }
      if (ruleIds.size === 0) return null;
    } else {
      return null;
    }
    return { routeId: sel.type === "route" ? sel.id : null, nodeIds, ruleIds, opIds };
  }, [sel, data.routes]);

  return (
    <div style={{ width: "100%", height: "100vh", background: T.bg, fontFamily: "'IBM Plex Sans', sans-serif", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* TOOLBAR */}
      <div style={{ height: 44, background: T.surface, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: compact ? "0 10px" : "0 14px", flexShrink: 0, zIndex: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 10 }}>
          <div style={{ width: 22, height: 22, borderRadius: 4, background: `linear-gradient(135deg, ${T.accent}, ${T.green})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>⌂</div>
          {!compact && <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Odoo Inventory Flow</span>}
          <span title={compact ? `${data.nodes.length} nodes · ${data.operationTypes.length} ops · ${data.routes.length} routes · ${data.routes.reduce((a, r) => a + r.rules.length, 0)} rules` : undefined}
                style={{ fontSize: 9, color: T.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>
            {data.nodes.length}n · {data.operationTypes.length}op · {data.routes.length}r · {data.routes.reduce((a, r) => a + r.rules.length, 0)}rl
          </span>
        </div>
        <div style={{ display: "flex", gap: compact ? 2 : 4 }}>
          <Btn small compact={compact} icon="download" onClick={handleFetchFromOdoo} disabled={!!fetchStatus?.loading} variant={fetchStatus?.error ? "danger" : "ghost"} title="Fetch live data from Odoo (replaces current diagram)">
            {fetchStatus?.loading ? (fetchStatus.progress || "Fetching…") : "Fetch from Odoo"}
          </Btn>
          <Btn small compact={compact} icon="upload" onClick={handlePushToOdoo} disabled={!fetchedSnapshot || !!pushStatus?.loading} variant={pushStatus?.error ? "danger" : pushStatus?.ok ? "default" : "ghost"} title="Push all changes to Odoo">
            {pushStatus?.loading ? (pushStatus.progress || "Pushing…") : pushStatus?.ok || "Push to Odoo"}
          </Btn>
          <div style={{ width: 1, height: 18, background: T.border, alignSelf: "center", margin: "0 2px" }} />
          <Btn small compact={compact} icon="upload" variant="ghost" title="Export…"
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect();
              setCtxMenu({ x: r.left, y: r.bottom + 4, items: [
                { id: "ex-json", icon: "{ }", label: "Export JSON",       hint: "Round-trip with Import",         run: handleExport },
                { id: "ex-svg",  icon: "✥",   label: "Export SVG (vector)", hint: "Infinite zoom · embeddable",   run: handleExportSvg },
                { id: "ex-png",  icon: "▦",   label: "Export PNG (2× retina)", hint: "Slides, email, screenshots", run: handleExportPng },
                { id: "ex-pdf",  icon: "▤",   label: "Export PDF (browser print)", hint: "Opens print dialog",     run: handleExportPdf },
                { id: "ex-md",   icon: "✎",   label: "Export Markdown",            hint: "Project handover document", run: handleExportMarkdown },
              ]});
            }}>Export</Btn>
          <Btn small compact={compact} icon="download" onClick={() => importRef.current?.click()} variant="ghost" title="Import diagram from JSON">Import</Btn>
          <input ref={importRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
          <Btn small variant="ghost" onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl+K or /)">
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>⌘K</span>
          </Btn>
          <Btn small compact={compact} icon="add" onClick={() => setShowAdd(true)} title="Add">Add</Btn>
          <Btn small compact={compact} icon="api" onClick={() => setShowApi(true)} title="Show API code">API</Btn>
          {!KONU_CFG && <Btn small icon="settings" onClick={() => setShowCfg(true)} title="Connection settings" />}
          {KONU_CFG && (
            <div title={`Customer: ${KONU_CFG.customerName}\nDB: ${KONU_CFG.dbName}\n${KONU_CFG.allowWrite ? 'Write enabled' : 'Read-only'}`}
                 style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", background: KONU_CFG.allowWrite ? T.amberSoft : T.greenSoft, color: KONU_CFG.allowWrite ? T.amber : T.green, border: `1px solid ${KONU_CFG.allowWrite ? T.amber : T.green}55`, borderRadius: 4, fontSize: 10, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
              <span>⌬</span>{!compact && <span>{KONU_CFG.connectionName}</span>}
              <span style={{ opacity: 0.7, fontSize: 8 }}>{KONU_CFG.allowWrite ? "RW" : "RO"}</span>
            </div>
          )}
          <Btn small variant="ghost" onClick={autoLayout} title="Auto-layout nodes">⊞</Btn>
          <Btn small variant="ghost"
               onClick={() => setOpVizMode(m => m === 'pills' ? 'pills_wash' : m === 'pills_wash' ? 'hidden' : 'pills')}
               title={`Op viz: ${opVizMode === 'pills' ? 'Pills' : opVizMode === 'pills_wash' ? 'Pills + wash' : 'Hidden (hover/select)'}. Click to cycle.`}
               style={opVizMode !== 'pills' ? { background: T.accentSoft, color: T.accent } : {}}>
            {opVizMode === 'pills' ? '◇' : opVizMode === 'pills_wash' ? '◆' : '◌'}
          </Btn>
          <Btn small variant="ghost" onClick={() => setHideUnused(v => !v)} title={hideUnused ? "Show all locations" : "Hide locations not used in any rule"} style={hideUnused ? { background: T.accentSoft, color: T.accent } : {}}>
            {compact ? (hideUnused ? "👁" : "✕") : (hideUnused ? "Show all" : "Hide unused")}
          </Btn>
          <Btn small variant="ghost" onClick={() => setIsDark(d => !d)} title={isDark ? "Switch to light mode" : "Switch to dark mode"}>{isDark ? "☀" : "☾"}</Btn>
          <div style={{ width: 1, height: 18, background: T.border, alignSelf: "center", margin: "0 2px" }} />
          <Btn small variant="ghost" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩</Btn>
          <Btn small variant="ghost" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪</Btn>
          {(sel || multiSel.size > 0) && (
            <>
              <div style={{ width: 1, height: 18, background: T.border, alignSelf: "center", margin: "0 2px" }} />
              <Btn small variant="ghost" onClick={() => zReorder("back")} title="Send to Back (Ctrl+[)">⤓</Btn>
              <Btn small variant="ghost" onClick={() => zReorder("bwd")} title="Send Backward ([)">↓</Btn>
              <Btn small variant="ghost" onClick={() => zReorder("fwd")} title="Bring Forward (])">↑</Btn>
              <Btn small variant="ghost" onClick={() => zReorder("front")} title="Bring to Front (Ctrl+])">⤒</Btn>
            </>
          )}
          <Btn small variant="ghost" onClick={() => setHelpOpen(true)} title="Help (?)">?</Btn>
          <Btn small variant="ghost" onClick={() => setShowTips(t => !t)} title="Canvas tips" style={showTips ? { background: T.accentSoft, color: T.accent } : {}}>ℹ</Btn>
          <Btn small variant="ghost" onClick={() => setCompact(c => !c)} title={compact ? "Expand toolbar (show labels)" : "Compact toolbar (icons only)"} style={compact ? { background: T.accentSoft, color: T.accent } : {}}>{compact ? "⇆" : "⇲"}</Btn>
          <div style={{ width: 1, height: 18, background: T.border, alignSelf: "center", margin: "0 2px" }} />
          <Btn small variant="ghost" icon="fit" onClick={fitToContent} title="Fit all nodes in view" />
          <div style={{ padding: "3px 7px", background: T.surfaceRaised, borderRadius: 3, border: `1px solid ${T.border}`, fontSize: 9, color: T.textDim, display: "flex", alignItems: "center", fontFamily: "'IBM Plex Mono', monospace" }}>{Math.round(scale * 100)}%</div>
        </div>
      </div>

      {/* ERROR BANNERS */}
      {fetchStatus?.error && (
        <div style={{ background: T.roseSoft, borderBottom: `1px solid ${T.rose}`, padding: "7px 16px", display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: T.rose, flexShrink: 0, zIndex: 50 }}>
          <span style={{ flex: 1, fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{fetchStatus.error}</span>
          <button onClick={() => setFetchStatus(null)} style={{ background: "none", border: "none", cursor: "pointer", color: T.rose, fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      )}
      {pushStatus?.error && (
        <div style={{ background: T.roseSoft, borderBottom: `1px solid ${T.rose}`, padding: "7px 16px", display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: T.rose, flexShrink: 0, zIndex: 50 }}>
          <span style={{ fontWeight: 600, flexShrink: 0 }}>Push failed:</span>
          <span style={{ flex: 1, fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{pushStatus.error}</span>
          <button onClick={() => setPushStatus(null)} style={{ background: "none", border: "none", cursor: "pointer", color: T.rose, fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      )}

      <div style={{ flex: 1, position: "relative", display: "flex" }}>
        {/* ROUTE SIDEBAR */}
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 230, background: `${T.surface}f0`, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", zIndex: 25, backdropFilter: "blur(8px)" }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>Routes & Rules</span>
            <input
              type="text"
              placeholder="Filter…"
              value={routeFilter}
              onChange={e => setRouteFilter(e.target.value)}
              style={{ width: "100%", padding: "5px 8px", background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text, fontSize: 11, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: T.textDim, cursor: "pointer" }}>
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} style={{ accentColor: T.accent, width: 12, height: 12 }} />
              Show inactive
            </label>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
            {(() => {
              const q = routeFilter.trim().toLowerCase();
              const baseRoutes = showInactive ? data.routes : data.routes.filter(r => !isDeactivated(r));
              const filtered = q
                ? baseRoutes.map(r => ({ ...r, rules: r.rules.filter(rl => rl.label.toLowerCase().includes(q)) })).filter(r => r.label.toLowerCase().includes(q) || r.rules.length > 0)
                : baseRoutes;
              if (filtered.length === 0) return <div style={{ padding: "12px 14px", fontSize: 9, color: T.textDim }}>No matches</div>;
              return filtered.map(route => {
              const rc = ROUTE_COLORS[route.colorIdx % ROUTE_COLORS.length];
              const h = hidden.has(route.id);
              const dim = isDeactivated(route);
              return (
                <div key={route.id} style={{ marginBottom: 2, opacity: dim ? 0.4 : 1 }}>
                  <div onClick={() => doSelect(route.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: rc.stroke, opacity: h ? 0.3 : 1, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: h ? T.textDim : T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{route.label}</span>
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
                        <span style={{ fontSize: 10, color: rc.stroke, fontFamily: "'IBM Plex Mono', monospace" }}>→</span>
                        <span style={{ fontSize: 10, color: T.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rule.label}</span>
                        <span style={{ fontSize: 8, color: T.textDim, marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace" }}>{rule.action}</span>
                      </div>
                    ))}
                    <div onClick={() => addRuleToRoute(route.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 12px 4px 28px", cursor: "pointer", borderLeft: "2px solid transparent", opacity: 0.45 }}
                      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; e.currentTarget.style.opacity = 0.8; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.opacity = 0.45; }}>
                      <SI d={ICONS.add} size={9} color={rc.stroke} />
                      <span style={{ fontSize: 9, color: rc.stroke, fontFamily: "'IBM Plex Mono', monospace" }}>Add rule</span>
                    </div>
                  </>)}
                </div>
              );
            });
            })()}
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
        <div style={{ flex: 1, marginLeft: 230, position: "relative" }}>
          {/* DRILL-IN BREADCRUMB — visible only in drill-in mode. */}
          {drillInto && (() => {
            const pivot = data.nodes.find(n => n.id === drillInto);
            if (!pivot) return null;
            // Build path from root → pivot via location_id chain.
            const path = [];
            let cur = pivot, depth = 0;
            while (cur && depth < 50) {
              path.unshift(cur);
              const pid = cur.data?.location_id;
              cur = pid ? data.nodes.find(n => n.id === pid) : null;
              depth++;
            }
            return (
              <div style={{ position: "absolute", top: 8, left: 8, right: 8, zIndex: 30,
                background: T.surface, border: `1px solid ${T.accent}55`, borderLeft: `3px solid ${T.accent}`,
                borderRadius: 6, padding: "6px 10px", display: "flex", alignItems: "center", gap: 8,
                fontSize: 11, color: T.text, fontFamily: "'IBM Plex Sans', sans-serif",
                boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
                <button onClick={() => setDrillInto(null)} title="Back to main canvas (Esc)"
                  style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text,
                    fontSize: 11, padding: "3px 8px", borderRadius: 4, fontFamily: "inherit", cursor: "pointer" }}>← back</button>
                <span style={{ color: T.textDim }}>Sub-locations of</span>
                {path.map((n, i) => (
                  <React.Fragment key={n.id}>
                    {i > 0 && <span style={{ color: T.textDim }}>›</span>}
                    <button onClick={() => i === path.length - 1 ? null : setDrillInto(n.id)}
                      style={{ background: i === path.length - 1 ? T.accentSoft : "transparent",
                        color: i === path.length - 1 ? T.accent : T.text,
                        border: "none", fontSize: 11, padding: "3px 6px", borderRadius: 3,
                        fontFamily: "inherit", cursor: i === path.length - 1 ? "default" : "pointer" }}>
                      {n.label}
                    </button>
                  </React.Fragment>
                ))}
                <span style={{ flex: 1 }} />
                <label title="Show putaway-rule arrows in drill-in"
                  style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: T.textDim, cursor: "pointer" }}>
                  <input type="checkbox" checked={drillShowPutaway} onChange={e => setDrillShowPutaway(e.target.checked)} /> Putaway
                </label>
                <label title="Show storage-category color regions"
                  style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: T.textDim, cursor: "pointer" }}>
                  <input type="checkbox" checked={drillShowCategories} onChange={e => setDrillShowCategories(e.target.checked)} /> Categories
                </label>
                <label title="Show capacity heatmap (needs Odoo quants fetched)"
                  style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: T.textDim, cursor: "pointer" }}>
                  <input type="checkbox" checked={drillShowHeatmap} onChange={e => setDrillShowHeatmap(e.target.checked)} /> Heatmap
                </label>
                <button onClick={() => setShowCategoriesModal(true)} title="Manage storage categories"
                  style={{ background: T.surfaceHover, border: `1px solid ${T.border}`, color: T.text,
                    fontSize: 10, padding: "3px 8px", borderRadius: 3, fontFamily: "inherit", cursor: "pointer" }}>📁 Categories…</button>
                <button onClick={() => setShowTestPutaway(true)} title="Simulate putaway resolution at this location"
                  style={{ background: T.accentSoft, border: `1px solid ${T.accent}55`, color: T.accent,
                    fontSize: 10, padding: "3px 8px", borderRadius: 3, fontFamily: "inherit", cursor: "pointer" }}>▶ Test putaway</button>
              </div>
            );
          })()}
          <svg ref={svgRef} width="100%" height="100%" style={{ cursor: isPan ? "grabbing" : spaceDown ? "grab" : "default", background: T.bg, userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none" }}
            onMouseDown={onCanvasDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onWheel={onWheel}
            onContextMenu={e => {
              // Only when right-clicking the actual background, not a node/edge/handle
              if (e.target !== svgRef.current && !e.target.getAttribute?.("data-bg")) return;
              e.preventDefault();
              const r = svgRef.current.getBoundingClientRect();
              const wx = (e.clientX - r.left - offset.x) / scale - NW / 2;
              const wy = (e.clientY - r.top - offset.y) / scale - NH / 2;
              const items = [
                { id: "add-loc",    icon: "◎", color: T.green,  label: "New Location",      run: () => doAdd("location",       { x: wx, y: wy }) },
                { id: "add-wh",     icon: "⌂", color: T.accent, label: "New Warehouse (wizard)", run: () => { setShowWizard(true); } },
                { id: "add-op",     icon: "⛁", color: T.amber,  label: "New Operation Type", run: () => doAdd("operation_type") },
                { id: "add-route",  icon: "⚡", color: T.sky,    label: "New Route",          run: () => doAdd("route") },
                { divider: true },
                { id: "tpl",        icon: "📋", label: "Apply Template…",                   run: () => setShowAdd(true) },
                { id: "palette",    icon: "⌘",  label: "Command Palette…", hotkey: "Ctrl+K", run: () => setPaletteOpen(true) },
                { divider: true },
                { id: "paste-here", icon: "⊞",  label: "Auto-layout",                      run: autoLayout },
                { id: "fit",        icon: "⊡",  label: "Fit all to view",                  run: fitToContent },
              ];
              setCtxMenu({ x: e.clientX, y: e.clientY, items });
            }}>
            <defs>
              <pattern id="dots" width={24 * scale} height={24 * scale} patternUnits="userSpaceOnUse" x={offset.x % (24 * scale)} y={offset.y % (24 * scale)}>
                <circle cx={1} cy={1} r={0.5} fill={T.borderLight} fillOpacity={0.25} />
              </pattern>
              {["incoming", "outgoing", "internal", "mrp_operation"].map(c => {
                const col = { incoming: T.green, outgoing: T.rose, internal: T.amber, mrp_operation: T.violet }[c];
                return <marker key={c} id={`arr-${c}`} markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill={col} fillOpacity={0.25} /></marker>;
              })}
              {ROUTE_COLORS.map(rc => (
                <marker key={rc.stroke} id={`arr-r-${rc.stroke.replace('#', '')}`} markerWidth={10} markerHeight={7} refX={9} refY={3.5} orient="auto">
                  <path d="M0,0 L10,3.5 L0,7 Z" fill={rc.stroke} fillOpacity={0.7} />
                </marker>
              ))}
            </defs>
            <rect data-bg="true" width="100%" height="100%" fill="url(#dots)" />

            {/* WAREHOUSE BLOBS — large dashed boundary around each warehouse's locations */}
            {data.nodes.filter(n => n.type === "warehouse").map(wh => {
              const ch = warehouseChildren.get(wh.id);
              if (!ch || ch.locations.length === 0) return null;
              const PAD_WH = 80;
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const l of ch.locations) {
                if (hideUnused && !usedLocationIds.has(l.id)) continue;
                if (l.x < minX) minX = l.x;
                if (l.y < minY) minY = l.y;
                if (l.x + NW > maxX) maxX = l.x + NW;
                if (l.y + NH > maxY) maxY = l.y + NH;
              }
              if (minX === Infinity) return null;
              minX -= PAD_WH; minY -= PAD_WH;
              maxX += PAD_WH; maxY += PAD_WH;
              const sxw = minX * scale + offset.x;
              const syw = minY * scale + offset.y;
              const sww = (maxX - minX) * scale;
              const shw = (maxY - minY) * scale;
              const isSelW = sel?.id === wh.id;
              const isDraggingW = dragId === wh.id && dragGroup?.warehouseId === wh.id;
              const wcol = T.accent;
              return (
                <g key={`whbg-${wh.id}`}
                   onMouseDown={e => { if (e.target.getAttribute("data-whbg")) { e.stopPropagation(); doSelect(wh.id); } }}
                   onContextMenu={e => openCtxMenu("warehouse", wh.id, e)}>
                  <title>{`${wh.label} — warehouse boundary`}</title>
                  <rect data-whbg="true" x={sxw} y={syw} width={sww} height={shw}
                        rx={Math.min(40, Math.min(sww, shw) / 6)}
                        ry={Math.min(40, Math.min(sww, shw) / 6)}
                        fill={`${wcol}07`} stroke={wcol}
                        strokeWidth={isDraggingW ? 2.4 : isSelW ? 2 : 1.4}
                        strokeDasharray={`${10 * scale} ${5 * scale}`}
                        strokeOpacity={isDraggingW ? 0.9 : isSelW ? 0.75 : 0.4}
                        style={{ cursor: "pointer" }} />
                  {/* Warehouse name tag — sits on the top edge, draggable selection-only */}
                  <foreignObject x={sxw + 14 * scale} y={syw - 13 * scale} width={320} height={24} style={{ overflow: "visible" }}>
                    <div onMouseDown={e => {
                           e.stopPropagation();
                           doSelect(wh.id);
                           if (!spaceDown) onDragStart(wh.id, e, "node");
                         }}
                         onDoubleClick={e => { e.stopPropagation(); setEditingLabel({ type: "warehouse", id: wh.id, value: wh.label }); }}
                         onContextMenu={e => openCtxMenu("warehouse", wh.id, e)}
                         style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", background: T.surface, border: `1.6px solid ${wcol}`, borderRadius: 5, cursor: "grab", whiteSpace: "nowrap", boxShadow: `0 2px 6px ${wcol}33`, userSelect: "none" }}>
                      <span style={{ fontSize: 14, color: wcol }}>⌂</span>
                      <span style={{ fontSize: 11 * Math.max(scale, 0.85), fontWeight: 700, color: wcol, textTransform: "uppercase", letterSpacing: "0.7px", fontFamily: "'IBM Plex Mono', monospace" }}>{wh.label}</span>
                      {wh.data?.code && <span style={{ fontSize: 9 * Math.max(scale, 0.85), color: T.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>{wh.data.code}</span>}
                      <span style={{ fontSize: 8 * Math.max(scale, 0.85), color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", paddingLeft: 4, borderLeft: `1px solid ${T.border}` }}>
                        {ch.locations.length} loc · {ch.opTypes.length} op
                      </span>
                    </div>
                  </foreignObject>
                </g>
              );
            })}

            {/* VIEW-LOCATION BLOBS — soft boundary around each view's children */}
            {data.nodes.filter(n => n.type === "location" && n.data?.usage === "view").map(v => {
              const ch = viewChildren.get(v.id);
              if (!ch || ch.locations.length === 0) return null;
              const PAD_V = 36;
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const l of ch.locations) {
                if (hideUnused && !usedLocationIds.has(l.id)) continue;
                if (l.x < minX) minX = l.x;
                if (l.y < minY) minY = l.y;
                if (l.x + NW > maxX) maxX = l.x + NW;
                if (l.y + NH > maxY) maxY = l.y + NH;
              }
              if (minX === Infinity) return null;
              minX -= PAD_V; minY -= PAD_V;
              maxX += PAD_V; maxY += PAD_V;
              const sxv = minX * scale + offset.x;
              const syv = minY * scale + offset.y;
              const swv = (maxX - minX) * scale;
              const shv = (maxY - minY) * scale;
              const isSelV = sel?.id === v.id;
              const vcol = T.textSoft;
              return (
                <g key={`viewbg-${v.id}`}
                   onMouseDown={e => { if (e.target.getAttribute("data-viewbg")) { e.stopPropagation(); doSelect(v.id); } }}
                   onContextMenu={e => openCtxMenu("location", v.id, e)}>
                  <title>{`${v.label} — view container`}</title>
                  <rect data-viewbg="true" x={sxv} y={syv} width={swv} height={shv}
                        rx={Math.min(20, Math.min(swv, shv) / 8)}
                        ry={Math.min(20, Math.min(swv, shv) / 8)}
                        fill={`${vcol}06`} stroke={vcol}
                        strokeWidth={isSelV ? 1.5 : 1}
                        strokeDasharray={`${4 * scale} ${3 * scale}`}
                        strokeOpacity={isSelV ? 0.7 : 0.35}
                        style={{ cursor: "pointer" }} />
                  <foreignObject x={sxv + 10 * scale} y={syv - 11 * scale} width={280} height={20} style={{ overflow: "visible" }}>
                    <div onMouseDown={e => { e.stopPropagation(); doSelect(v.id); if (!spaceDown) onDragStart(v.id, e, "node"); }}
                         onDoubleClick={e => { e.stopPropagation(); setEditingLabel({ type: "location", id: v.id, value: v.label }); }}
                         onContextMenu={e => openCtxMenu("location", v.id, e)}
                         style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 7px", background: T.surface, border: `1.2px solid ${vcol}`, borderRadius: 4, cursor: "grab", whiteSpace: "nowrap", userSelect: "none" }}>
                      <span style={{ fontSize: 10, color: vcol }}>▢</span>
                      <span style={{ fontSize: 10 * Math.max(scale, 0.85), fontWeight: 700, color: vcol, textTransform: "uppercase", letterSpacing: "0.6px", fontFamily: "'IBM Plex Mono', monospace" }}>{v.label}</span>
                      <span style={{ fontSize: 8 * Math.max(scale, 0.85), color: T.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>view · {ch.locations.length}</span>
                    </div>
                  </foreignObject>
                </g>
              );
            })}

            {/* OP TYPE WASH — faded color rect per op-type, only in 'pills_wash' mode.
                Replaces the older blob+leader-line UI; pill rendering happens after edges below. */}
            {opVizMode === 'pills_wash' && (() => {
              const PAD = 30;
              return data.operationTypes.map(op => {
                const sn = data.nodes.find(n => n.id === op.src_location_id);
                const dn = data.nodes.find(n => n.id === op.dest_location_id);
                if (!sn || !dn) return null;
                const minX = Math.min(sn.x, dn.x) - PAD;
                const minY = Math.min(sn.y, dn.y) - PAD;
                const maxX = Math.max(sn.x + NW, dn.x + NW) + PAD;
                const maxY = Math.max(sn.y + NH, dn.y + NH) + PAD;
                const sx = minX * scale + offset.x, sy = minY * scale + offset.y;
                const sw = (maxX - minX) * scale, sh = (maxY - minY) * scale;
                // Per-op stable hue (mid-saturation, mid-lightness so wash reads as colored)
                const hue = hashColor(op.id, 60, 50);
                const dimOp = routeHighlight && !routeHighlight.opIds.has(op.id);
                return (
                  <rect key={`wash-${op.id}`} x={sx} y={sy} width={sw} height={sh}
                        rx={20 * scale} ry={20 * scale}
                        fill={hue} fillOpacity={dimOp ? 0.02 : 0.08} stroke="none" pointerEvents="none" />
                );
              });
            })()}

            {/* TODO: remove dead op-blob code path after pills/wash settle in production.
                Auto-layout still computes labelDx/Dy on each op; those values are now
                unused by the renderer but harmless. Rip out once the new viz proves out. */}
            {false && (() => {
              // Build world-space bounding box per op
              const PAD = 30;
              const items = [];
              for (const op of data.operationTypes) {
                if (isDeactivated(op) && !showInactive) continue;
                const sn = data.nodes.find(n => n.id === op.src_location_id);
                const dn = data.nodes.find(n => n.id === op.dest_location_id);
                if (!sn || !dn) continue;
                const minX = Math.min(sn.x, dn.x) - PAD;
                const minY = Math.min(sn.y, dn.y) - PAD;
                const maxX = Math.max(sn.x + NW, dn.x + NW) + PAD;
                const maxY = Math.max(sn.y + NH, dn.y + NH) + PAD;
                items.push({ op, sn, dn, minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
              }
              // Cluster by AABB overlap (union-find by relabel)
              const cluster = new Array(items.length).fill(-1);
              let nextC = 0;
              const overlap = (a, b) => !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
              for (let i = 0; i < items.length; i++) {
                if (cluster[i] === -1) cluster[i] = nextC++;
                for (let j = i + 1; j < items.length; j++) {
                  if (overlap(items[i], items[j])) {
                    if (cluster[j] === -1) cluster[j] = cluster[i];
                    else if (cluster[j] !== cluster[i]) {
                      const cj = cluster[j], ci = cluster[i];
                      for (let k = 0; k < items.length; k++) if (cluster[k] === cj) cluster[k] = ci;
                    }
                  }
                }
              }
              // Within each cluster, assign labelIdx by minY then id
              const byCluster = new Map();
              items.forEach((b, i) => {
                const c = cluster[i];
                if (!byCluster.has(c)) byCluster.set(c, []);
                byCluster.get(c).push({ b, i });
              });
              const labelIdxOf = new Map();
              const clusterTopY = new Map();
              for (const [c, arr] of byCluster) {
                arr.sort((a, b) => a.b.minY - b.b.minY || a.b.op.id.localeCompare(b.b.op.id));
                arr.forEach((x, i) => labelIdxOf.set(x.b.op.id, i));
                clusterTopY.set(c, Math.min(...arr.map(x => x.b.minY)));
              }

              const LABEL_H = 16;
              // Stable sort indices by z (clustering above stays valid)
              const renderOrder = items.map((_, i) => i).sort((a, c) => ((items[a].op.z || 0) - (items[c].op.z || 0)) || (a - c));
              return renderOrder.map(i => {
                const b = items[i];
                const op = b.op, sn = b.sn, dn = b.dn;
                // Blob and legend share one color — the per-code semantic palette
                const col = { incoming: T.green, outgoing: T.rose, internal: T.amber, mrp_operation: T.violet }[op.code] || T.amber;
                const labelCol = col;
                const isSel = sel?.id === op.id;
                const sx = b.minX * scale + offset.x, sy = b.minY * scale + offset.y;
                const sw = (b.maxX - b.minX) * scale, sh = (b.maxY - b.minY) * scale;
                const idx = labelIdxOf.get(op.id) || 0;
                const cTopY = clusterTopY.get(cluster[i]);
                // Default label position: above the cluster's topmost edge, stacked
                // (only when labelDx/Dy are 0 — i.e. neither auto-placed nor user-dragged).
                // When labelDx/Dy is set (auto-layout or manual drag), anchor to *this op's*
                // blob top-left so the renderer matches what the auto-placer / drag computed.
                const hasLabelOffset = (op.labelDx || 0) !== 0 || (op.labelDy || 0) !== 0;
                const labelXWorld = b.minX + 6 + (op.labelDx || 0);
                const labelYWorld = hasLabelOffset
                  ? b.minY - 14 + (op.labelDy || 0)
                  : cTopY - 14 - idx * (LABEL_H + 2);
                const labelX = labelXWorld * scale + offset.x;
                const labelY = labelYWorld * scale + offset.y;
                // Anchor the leader line to the closest point on the blob's perimeter.
                // Compute projections onto each of the 4 rectangle edges, pick the nearest.
                const labelCxWorld = labelXWorld + 60; // approx label center x
                const labelCyWorld = labelYWorld + LABEL_H / 2;
                const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
                const candidates = [
                  { x: clamp(labelCxWorld, b.minX, b.maxX), y: b.minY }, // top edge
                  { x: clamp(labelCxWorld, b.minX, b.maxX), y: b.maxY }, // bottom
                  { x: b.minX, y: clamp(labelCyWorld, b.minY, b.maxY) }, // left
                  { x: b.maxX, y: clamp(labelCyWorld, b.minY, b.maxY) }, // right
                ];
                let nearest = candidates[0], best = Infinity;
                for (const c of candidates) {
                  const dx2 = c.x - labelCxWorld, dy2 = c.y - labelCyWorld;
                  const d2 = dx2 * dx2 + dy2 * dy2;
                  if (d2 < best) { best = d2; nearest = c; }
                }
                const cornerX = nearest.x * scale + offset.x;
                const cornerY = nearest.y * scale + offset.y;
                const labelAnchorX = labelX + 6;
                const labelAnchorY = labelY + LABEL_H / 2;

                const { sp, dp, ss, ds } = bestPorts(sn, dn);
                const p1 = { x: sp.x * scale + offset.x, y: sp.y * scale + offset.y };
                const p2 = { x: dp.x * scale + offset.x, y: dp.y * scale + offset.y };

                const dimOp = routeHighlight && !routeHighlight.nodeIds.has(op.src_location_id) && !routeHighlight.nodeIds.has(op.dest_location_id);
                const opInactive = isDeactivated(op);
                const hasManualLabel = (op.labelDx || 0) !== 0 || (op.labelDy || 0) !== 0;
                return (
                  <g key={op.id} opacity={dimOp ? 0.15 : (opInactive ? 0.4 : 1)}
                     onContextMenu={e => openCtxMenu("operation_type", op.id, e)}
                     onMouseDown={e => { if (e.target.getAttribute("data-gbg")) { e.stopPropagation(); doSelect(op.id); onDragStart(op.id, e, "group"); } }}>
                    <title>{`${op.label}\n${op.code} · ${op.sequence_code || ""}`}</title>
                    <rect data-gbg="true" x={sx} y={sy} width={sw} height={sh} rx={Math.min(28, Math.min(sw, sh) / 4)} ry={Math.min(28, Math.min(sw, sh) / 4)} fill={`${col}0a`} stroke={col} strokeWidth={isSel ? 1.6 : 1} strokeDasharray={`${5 * scale} ${4 * scale}`} strokeOpacity={isSel ? 0.75 : 0.28} style={{ cursor: "grab" }} />
                    {/* Leader line — anchored to the closest point on the blob perimeter, in the label's own color */}
                    <line x1={labelAnchorX} y1={labelAnchorY + 1} x2={cornerX} y2={cornerY}
                          stroke={labelCol} strokeWidth={1}
                          strokeOpacity={isSel ? 0.85 : 0.55}
                          strokeDasharray="3 2" pointerEvents="none" />
                    {/* Small dot at the perimeter anchor — visual cue, also label-colored */}
                    <circle cx={cornerX} cy={cornerY} r={isSel ? 2.8 : 2.2}
                            fill={labelCol} fillOpacity={isSel ? 0.95 : 0.7} pointerEvents="none" />
                    {/* Label callout — drag to reposition; double-click resets */}
                    <foreignObject x={labelX - 4} y={labelY} width={280} height={LABEL_H + 2} style={{ overflow: "visible" }}>
                      <div onMouseDown={e => {
                             e.stopPropagation();
                             doSelect(op.id);
                             // Start label drag — separate gesture from blob group drag
                             onDragStart(op.id, e, "oplabel");
                           }}
                           onDoubleClick={e => {
                             e.stopPropagation();
                             doUpdate("operation_type", op.id, { labelDx: 0, labelDy: 0 });
                           }}
                           onContextMenu={e => openCtxMenu("operation_type", op.id, e)}
                           title={hasManualLabel ? "Drag to reposition · Double-click to reset" : "Drag to reposition the label"}
                           style={{ display: "inline-flex", alignItems: "center", gap: 5, background: T.surface, border: `1.5px solid ${labelCol}`, borderRadius: 4, padding: "2px 7px", cursor: "grab", maxWidth: 270, whiteSpace: "nowrap", overflow: "hidden", userSelect: "none", boxShadow: `0 1px 3px ${labelCol}33` }}>
                        <span style={{ fontSize: 9 * Math.max(scale, 0.8), fontWeight: 700, color: labelCol, textTransform: "uppercase", letterSpacing: "0.7px", fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>⛁ {op.label}</span>
                        {op.sequence_code && <span style={{ fontSize: 8 * Math.max(scale, 0.8), color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0 }}>{op.sequence_code}</span>}
                      </div>
                    </foreignObject>
                    <path d={bPath(p1, p2, ss, ds)} fill="none" stroke={col} strokeWidth={1.3} strokeOpacity={0.18} strokeDasharray="4 3" markerEnd={`url(#arr-${op.code})`} />
                  </g>
                );
              });
            })()}

            {/* DRILL-IN LAYERS — only render when drillInto is set. */}
            {drillInto && (() => {
              const layers = [];
              const pivot = data.nodes.find(n => n.id === drillInto);
              if (!pivot) return null;
              // Direct children of the pivot (one level only — deeper levels render their own children below).
              const directKids = data.nodes.filter(n =>
                n.type === "location" && n.data?.location_id === drillInto
              );

              // (a) Storage-category color regions — wash behind each child node.
              if (drillShowCategories) {
                for (const k of directKids) {
                  const cid = k.data?.storage_category_id;
                  if (!cid) continue;
                  const sx = k.x * scale + offset.x, sy = k.y * scale + offset.y;
                  const sw = NW * scale, sh = NH * scale;
                  layers.push(
                    <rect key={`cat-wash-${k.id}`} x={sx - 14} y={sy - 14}
                          width={sw + 28} height={sh + 28} rx={14} ry={14}
                          fill={hashColor(cid, 50, 55)} fillOpacity={0.12}
                          stroke="none" pointerEvents="none" />
                  );
                }
              }

              // (b) Capacity heatmap — tint child node backdrops by current/capacity.
              if (drillShowHeatmap) {
                const quants = data._quantsByLocation || {};
                for (const k of directKids) {
                  const cap = k.data?.capacity_qty || k.data?.capacity || 0;
                  const cur = quants[k.id];
                  let fill = "rgba(180,180,180,0.10)";   // unknown / no quants
                  if (cap > 0 && cur !== undefined) {
                    const ratio = cur / cap;
                    if (ratio < 0.7) fill = "rgba(34, 197, 94, 0.18)";    // green
                    else if (ratio < 0.95) fill = "rgba(251, 146, 60, 0.22)"; // amber
                    else fill = "rgba(239, 68, 68, 0.25)";                // red
                  }
                  const sx = k.x * scale + offset.x, sy = k.y * scale + offset.y;
                  const sw = NW * scale, sh = NH * scale;
                  layers.push(
                    <rect key={`heat-${k.id}`} x={sx - 6} y={sy - 6}
                          width={sw + 12} height={sh + 12} rx={9} ry={9}
                          fill={fill} stroke="none" pointerEvents="none" />
                  );
                }
              }

              // (c) Tree edges — faint dashed lines from pivot center to each child.
              {
                const px = (pivot.x + NW / 2) * scale + offset.x;
                const py = (pivot.y + NH / 2) * scale + offset.y;
                for (const k of directKids) {
                  const kx = (k.x + NW / 2) * scale + offset.x;
                  const ky = (k.y + NH / 2) * scale + offset.y;
                  layers.push(
                    <line key={`tree-${k.id}`} x1={px} y1={py} x2={kx} y2={ky}
                          stroke={T.textDim} strokeWidth={1} strokeOpacity={0.35}
                          strokeDasharray="3 3" pointerEvents="none" />
                  );
                }
              }

              // (d) Putaway-rule arrows — colored from pivot to matching child.
              if (drillShowPutaway) {
                const rules = (data.putawayRules || []).filter(r => r.location_in_id === drillInto);
                for (const r of rules) {
                  const target = r.location_out_id ? data.nodes.find(n => n.id === r.location_out_id) : null;
                  if (!target) continue;
                  const sx = (pivot.x + NW / 2) * scale + offset.x;
                  const sy = (pivot.y + NH) * scale + offset.y;
                  const dx = (target.x + NW / 2) * scale + offset.x;
                  const dy = target.y * scale + offset.y;
                  const hue = hashColor(r.id, 65, 50);
                  layers.push(
                    <g key={`pa-arrow-${r.id}`} pointerEvents="none">
                      <line x1={sx} y1={sy} x2={dx} y2={dy} stroke={hue} strokeWidth={1.5} strokeOpacity={0.7} />
                      <circle cx={dx} cy={dy} r={3} fill={hue} fillOpacity={0.8} />
                      <text x={(sx + dx) / 2} y={(sy + dy) / 2 - 4} fontSize={9} fill={hue}
                            textAnchor="middle" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                        {r.product || r.category || `seq ${r.sequence ?? '–'}`}
                      </text>
                    </g>
                  );
                }
              }

              return layers;
            })()}

            {/* ROUTE RULE EDGES — hidden in drill-in mode. */}
            {!drillInto && (() => {
              const edgeOffsets = edgeOffsetMap;
              return data.routes.map(route => {
                if (hidden.has(route.id)) return null;
                const routeInactive = isDeactivated(route);
                if (routeInactive && !showInactive) return null;
                const rc = ROUTE_COLORS[route.colorIdx % ROUTE_COLORS.length];
                return route.rules.map(rule => {
                  const sn = data.nodes.find(n => n.id === rule.src_location_id);
                  const dn = data.nodes.find(n => n.id === rule.dest_location_id);
                  if (!sn || !dn) return null;
                  const { sp, dp, ss, ds } = bestPorts(sn, dn);
                  const p1 = { x: sp.x * scale + offset.x, y: sp.y * scale + offset.y };
                  const p2 = { x: dp.x * scale + offset.x, y: dp.y * scale + offset.y };
                  const curveOff = edgeOffsets.get(rule.id) ?? 0;
                  const d = bPath(p1, p2, ss, ds, curveOff);
                  const mid = bezierPoint(p1, p2, ss, ds, curveOff, 0.5);
                  const dotPos = bezierPoint(p1, p2, ss, ds, curveOff, 0.86);
                  const isSel = sel?.id === rule.id;
                  const dimEdge = routeHighlight && !routeHighlight.ruleIds.has(rule.id);
                  const meta = ACTION_META[rule.action] || ACTION_META.pull;
                  const dashArr = meta.dash === 0 ? undefined : meta.dash.map(v => v * Math.max(scale, 0.7)).join(" ");
                  const procure = rule.data?.procure_method || rule.procure_method || "make_to_stock";
                  const isMto = procure === "make_to_order" || procure === "mts_else_mto";
                  const dotR = 3.2 * Math.max(scale, 0.7);
                  // Umbrella detection: rule.dest != picking_type's default dest (or src mismatches)
                  const op = data.operationTypes.find(o => o.id === rule.picking_type_id);
                  const isUmbrella = !!(op && (op.dest_location_id !== rule.dest_location_id || op.src_location_id !== rule.src_location_id));
                  const tip = `${meta.label} · ${procure.replace(/_/g, "-")} · ${rule.data?.delay || 0}d · ${rule.data?.auto || rule.auto || "manual"}${isUmbrella ? `\nUmbrella → real picking ${op.src_location_id ? `${(data.nodes.find(n=>n.id===op.src_location_id)?.label||"?")} → ${(data.nodes.find(n=>n.id===op.dest_location_id)?.label||"?")}` : ""}` : ""}`;
                  return (
                    <g key={rule.id} opacity={dimEdge ? 0.12 : (routeInactive ? 0.4 : 1)}
                       onClick={e => { e.stopPropagation(); doSelect(rule.id); }}
                       onMouseEnter={() => setHoveredRuleId(rule.id)}
                       onMouseLeave={() => setHoveredRuleId(prev => prev === rule.id ? null : prev)}
                       style={{ cursor: "pointer" }}>
                      <title>{`${rule.label}\n${tip}`}</title>
                      {/* Invisible wide hit-area path so the edge is easy to click */}
                      <path d={d} fill="none" stroke="transparent" strokeWidth={14} pointerEvents="stroke" />
                      {/* Ghost halo for umbrella rules — wider, semi-transparent below */}
                      {isUmbrella && (
                        <path d={d} fill="none" stroke={rc.stroke} strokeWidth={isSel ? 14 : 11} strokeOpacity={isSel ? 0.18 : 0.10} strokeLinecap="round" pointerEvents="none" />
                      )}
                      <path d={d} fill="none" stroke={rc.stroke} strokeWidth={isSel ? 6 : 3} strokeOpacity={isSel ? 0.2 : 0.05} pointerEvents="none" />
                      <path d={d} fill="none" stroke={rc.stroke} strokeWidth={isSel ? 2.5 : 1.8} strokeOpacity={isSel ? 1 : 0.5} strokeDasharray={dashArr} markerEnd={`url(#arr-r-${rc.stroke.replace('#', '')})`} />
                      {/* MTO/MTS marker — filled = MTO, hollow = MTS */}
                      <circle cx={dotPos.x} cy={dotPos.y} r={dotR} fill={isMto ? rc.stroke : T.bg} stroke={rc.stroke} strokeWidth={1.2} strokeOpacity={0.9} />
                      {/* Action glyph (buy/manufacture) at midpoint */}
                      {meta.glyph && (
                        <g transform={`translate(${mid.x},${mid.y - 14})`}>
                          <circle r={7 * Math.max(scale, 0.7)} fill={T.bg} stroke={rc.stroke} strokeWidth={1.2} />
                          <text x={0} y={0} fontSize={9 * Math.max(scale, 0.7)} fontWeight={700} fill={rc.stroke} textAnchor="middle" dominantBaseline="central" fontFamily="'IBM Plex Mono', monospace">{meta.glyph}</text>
                        </g>
                      )}
                      <foreignObject x={mid.x - 70} y={mid.y - 18} width={140} height={20}>
                        <div style={{ display: "flex", justifyContent: "center", pointerEvents: "none" }}>
                          <span style={{ fontSize: 8 * Math.max(scale, 0.7), fontWeight: 600, color: rc.stroke, background: `${T.bg}dd`, padding: "1px 5px", borderRadius: 2, fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>
                            {isUmbrella && <span style={{ opacity: 0.7, marginRight: 3 }}>↳</span>}{rule.label}
                          </span>
                        </div>
                      </foreignObject>
                    </g>
                  );
                });
              });
            })()}

            {/* OP-TYPE PILLS — inline capsule pill at each rule's edge midpoint
                showing the picking-type's sequence_code. Multi-pill stacking:
                rules sharing the same (src, dst) get fanned perpendicular to the
                edge; same-op duplicates within a group collapse to one pill.
                In 'hidden' mode, only render pills for hovered or selected rules. */}
            {(() => {
              if (!data.operationTypes.length) return null;
              const opById = new Map(data.operationTypes.map(o => [o.id, o]));
              // Group rules by (src, dst) — pill fanning offset is per-group.
              const groupBySrcDst = new Map();
              for (const route of data.routes) {
                if (hidden.has(route.id)) continue;
                for (const rule of route.rules) {
                  if (!rule.picking_type_id) continue;
                  if (!opById.has(rule.picking_type_id)) continue;
                  const sn = data.nodes.find(n => n.id === rule.src_location_id);
                  const dn = data.nodes.find(n => n.id === rule.dest_location_id);
                  if (!sn || !dn) continue;
                  const key = `${rule.src_location_id}\t${rule.dest_location_id}`;
                  if (!groupBySrcDst.has(key)) groupBySrcDst.set(key, []);
                  groupBySrcDst.get(key).push({ rule, route });
                }
              }
              // Within each group, dedupe by picking_type_id so two rules pointing at
              // the same op show one pill. The first rule encountered owns the pill.
              const renders = [];
              const PILL_H = 16;
              const PILL_PAD_X = 7;
              const FANSTEP = PILL_H + 2;
              for (const [, list] of groupBySrcDst) {
                const seenOps = new Set();
                const unique = [];
                for (const entry of list) {
                  if (seenOps.has(entry.rule.picking_type_id)) continue;
                  seenOps.add(entry.rule.picking_type_id);
                  unique.push(entry);
                }
                const n = unique.length;
                unique.forEach((entry, i) => {
                  const { rule } = entry;
                  // In hidden mode, only render the pill for the hovered or selected rule
                  const visible =
                    opVizMode !== 'hidden' ||
                    hoveredRuleId === rule.id ||
                    sel?.id === rule.id ||
                    sel?.id === rule.picking_type_id;
                  if (!visible) return;
                  const op = opById.get(rule.picking_type_id);
                  const sn = data.nodes.find(nn => nn.id === rule.src_location_id);
                  const dn = data.nodes.find(nn => nn.id === rule.dest_location_id);
                  if (!op || !sn || !dn) return;
                  const { sp, dp, ss, ds } = bestPorts(sn, dn);
                  const p1 = { x: sp.x * scale + offset.x, y: sp.y * scale + offset.y };
                  const p2 = { x: dp.x * scale + offset.x, y: dp.y * scale + offset.y };
                  const curveOff = edgeOffsetMap.get(rule.id) ?? 0;
                  const mid = bezierPoint(p1, p2, ss, ds, curveOff, 0.5);
                  // Pill text width estimate (monospace ~6.2px/char at 10px font)
                  const text = op.sequence_code || op.code || op.label?.slice(0, 4) || '?';
                  const pillW = Math.max(20, Math.round(text.length * 6.4 + PILL_PAD_X * 2));
                  // Stack offset perpendicular to edge — for now, vertical stacking
                  const stackOff = (i - (n - 1) / 2) * FANSTEP;
                  const px = mid.x - pillW / 2;
                  const py = mid.y - PILL_H / 2 + stackOff;
                  const fill = hashColor(op.id, 60, 35);
                  const isHi = sel?.id === op.id || sel?.id === rule.id || hoveredRuleId === rule.id;
                  const dimPill = routeHighlight && !routeHighlight.opIds.has(op.id) && !routeHighlight.ruleIds.has(rule.id);
                  renders.push(
                    <g key={`pill-${rule.id}`}
                       opacity={dimPill ? 0.18 : 1}
                       onClick={e => { e.stopPropagation(); doSelect(op.id); }}
                       onMouseEnter={() => setHoveredRuleId(rule.id)}
                       onMouseLeave={() => setHoveredRuleId(prev => prev === rule.id ? null : prev)}
                       style={{ cursor: 'pointer' }}>
                      <title>{`${op.label}${op.sequence_code ? ` · ${op.sequence_code}` : ''}\n${op.code || ''}`}</title>
                      <rect x={px} y={py} width={pillW} height={PILL_H}
                            rx={PILL_H / 2} ry={PILL_H / 2}
                            fill={fill}
                            stroke={isHi ? '#fff' : 'none'}
                            strokeWidth={1} />
                      <text x={mid.x} y={py + PILL_H / 2 + 1}
                            fill="#fff" fontSize={10}
                            textAnchor="middle" dominantBaseline="middle"
                            style={{ fontFamily: "'IBM Plex Mono', monospace", pointerEvents: 'none', fontWeight: 600, letterSpacing: '0.5px' }}>
                        {text}
                      </text>
                    </g>
                  );
                });
              }
              return renders;
            })()}

            {/* NODES */}
            {[...data.nodes].sort((a, b) => (a.z || 0) - (b.z || 0)).map(node => {
              if (hideUnused && node.type === "location" && !usedLocationIds.has(node.id)) return null;
              if (isDeactivated(node) && !showInactive) return null;
              // Drill-in viewport filter: when drillInto is set, show only the
              // pivot node + its descendants. Sub-locations (n.data.location_id set)
              // are HIDDEN on the main canvas; they only render in drill-in.
              if (drillInto) {
                const isPivot = node.id === drillInto;
                const isDesc = node.type === "location" && (() => {
                  let cur = node, depth = 0;
                  while (cur && depth < 50) {
                    const pid = cur.data?.location_id;
                    if (pid === drillInto) return true;
                    if (!pid) return false;
                    cur = data.nodes.find(n => n.id === pid);
                    depth++;
                  }
                  return false;
                })();
                if (!isPivot && !isDesc) return null;
              } else {
                // Main canvas: hide all sub-locations (they only show in drill-in).
                if (node.type === "location" && node.data?.location_id) return null;
              }
              // Warehouses with children render as a blob+name-tag layer above; hide the small rect.
              if (node.type === "warehouse" && (warehouseChildren.get(node.id)?.locations.length || 0) > 0) return null;
              // View locations with children also render as a blob; hide the leaf rect.
              if (node.type === "location" && node.data?.usage === "view" && (viewChildren.get(node.id)?.locations.length || 0) > 0) return null;
              const s = nodeVisual(node);
              const nodeInactive = isDeactivated(node);
              const cornerR = s.shape === "pill" ? Math.min(NW, NH) / 2 : 9;
              const dashArr = dashFor(s.border, scale);
              const sx = node.x * scale + offset.x, sy = node.y * scale + offset.y;
              const isSel = sel?.id === node.id;
              const isMultiSel = multiSel.has(node.id);
              const dimNode = routeHighlight && !routeHighlight.nodeIds.has(node.id);
              const paCount = node.type === "location" ? data.putawayRules.filter(r => r.location_in_id === node.id).length : 0;
              return (
                <g key={node.id} opacity={dimNode ? 0.18 : (nodeInactive ? 0.4 : 1)}
                  onMouseEnter={() => setHoverId(node.id)}
                  onMouseLeave={() => setHoverId(h => h === node.id ? null : h)}
                  onMouseDown={e => {
                  // Spacebar held = pan mode, treat node-click as bg pan
                  if (spaceDown) {
                    setIsPan(true); setPanSt({ x: e.clientX - offset.x, y: e.clientY - offset.y });
                    downPosRef.current = { x: e.clientX, y: e.clientY, kind: "bg" };
                    dragThresholdRef.current = false;
                    return;
                  }
                  e.stopPropagation();
                  if (e.shiftKey) {
                    setMultiSel(prev => { const n = new Set(prev); n.has(node.id) ? n.delete(node.id) : n.add(node.id); return n; });
                  } else {
                    const isMultiDrag = multiSel.has(node.id) && multiSel.size > 1;
                    if (!isMultiDrag) setMultiSel(new Set());
                    doSelect(node.id);
                    onDragStart(node.id, e, "node", isMultiDrag);
                  }
                }}
                  onDoubleClick={e => {
                    e.stopPropagation();
                    if (node.type === "location" || node.type === "warehouse") {
                      setEditingLabel({ type: node.type, id: node.id, value: node.label });
                    }
                  }}
                  onContextMenu={e => openCtxMenu(node.type, node.id, e)}
                  style={{ cursor: spaceDown ? "grab" : "grab" }}>
                  <title>{node.label} — double-click to rename</title>
                  {/* Hover halo — feels more interactive */}
                  {hoverId === node.id && !isSel && (
                    <rect x={sx - 2 * scale} y={sy - 2 * scale} width={(NW + 4) * scale} height={(NH + 4) * scale} rx={6 * scale} fill="none" stroke={s.color} strokeWidth={1} strokeOpacity={0.45} pointerEvents="none" />
                  )}
                  {isMultiSel && <rect x={sx - 3 * scale} y={sy - 3 * scale} width={(NW + 6) * scale} height={(NH + 6) * scale} rx={(cornerR + 2) * scale} fill="none" stroke={T.accent} strokeWidth={1.5} strokeDasharray={`${4 * scale} ${3 * scale}`} />}
                  <rect x={sx} y={sy} width={NW * scale} height={NH * scale} rx={cornerR * scale}
                        fill={s.virtual ? `${s.color}10` : T.surface}
                        stroke={isSel ? T.text : s.color}
                        strokeWidth={isSel ? 2 : 1}
                        strokeOpacity={isSel ? 1 : (s.virtual ? 0.6 : 0.5)}
                        strokeDasharray={dashArr}
                        opacity={s.virtual ? 0.85 : 1} />
                  {/* Color tab on left edge — only on non-pill (rect) nodes */}
                  {s.shape !== "pill" && (
                    <rect x={sx} y={sy + 6 * scale} width={3 * scale} height={(NH - 12) * scale} rx={1.5 * scale} fill={s.color} fillOpacity={0.7} />
                  )}
                  <text x={sx + (s.shape === "pill" ? 22 : 18) * scale} y={sy + NH / 2 * scale}
                        fontSize={(s.icon.length > 1 ? 13 : 16) * Math.max(scale, 0.55)}
                        fill={s.color} textAnchor="middle" dominantBaseline="central">{s.icon}</text>
                  {editingLabel?.id === node.id ? (
                    <foreignObject x={sx + 30 * scale} y={sy + 8 * scale} width={(NW - 36) * scale} height={(NH - 16) * scale}>
                      <input autoFocus value={editingLabel.value}
                        onChange={e => setEditingLabel(s => ({ ...s, value: e.target.value }))}
                        onClick={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                        onKeyDown={e => {
                          if (e.key === "Enter") { doUpdate(node.type, node.id, { label: editingLabel.value }); setEditingLabel(null); }
                          else if (e.key === "Escape") setEditingLabel(null);
                        }}
                        onBlur={() => { doUpdate(node.type, node.id, { label: editingLabel.value }); setEditingLabel(null); }}
                        style={{ width: "100%", height: "100%", padding: "2px 6px", background: T.surfaceRaised, border: `1px solid ${T.accent}`, borderRadius: 4, color: T.text, fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif", outline: "none", boxSizing: "border-box" }} />
                    </foreignObject>
                  ) : (
                    <text x={sx + (NW - 10) * scale} y={sy + (node.data?.usage ? NH * 0.38 : NH / 2) * scale} fontSize={15 * Math.max(scale, 0.55)} fontWeight={600} fill={T.text} fontFamily="'IBM Plex Sans', sans-serif" dominantBaseline="central" textAnchor="end" pointerEvents="none" style={{ userSelect: "none" }}>
                      {(() => { const parts = node.label.split("/"); const last = parts[parts.length - 1].trim(); return last.length > 24 ? last.slice(0, 24) + "…" : last; })()}
                    </text>
                  )}
                  {node.data?.usage && !editingLabel?.id && (
                    <text x={sx + (NW - 10) * scale} y={sy + NH * 0.72 * scale} fontSize={10 * Math.max(scale, 0.55)} fill={T.textDim} fontFamily="'IBM Plex Mono', monospace" dominantBaseline="central" textAnchor="end" pointerEvents="none" style={{ userSelect: "none" }}>{node.data.usage}</text>
                  )}
                  {/* Connection ports — 4 sides + 4 corners. Invisible large hit-area + visible small dot, scale-up on hover */}
                  {["l", "r", "t", "b", "tl", "tr", "bl", "br"].map(side => {
                    const p = nodePort(node, side);
                    const cx = p.x * scale + offset.x;
                    const cy = p.y * scale + offset.y;
                    const showBig = hoverId === node.id || isSel || connect?.srcId === node.id;
                    return (
                      <g key={side}>
                        <circle cx={cx} cy={cy} r={9} fill="transparent"
                          style={{ cursor: "crosshair" }}
                          onMouseDown={e => {
                            e.stopPropagation();
                            doSelect(node.id);
                            setConnect({ srcId: node.id, srcSide: side, mx: e.clientX, my: e.clientY });
                            downPosRef.current = { x: e.clientX, y: e.clientY, kind: "port" };
                            dragThresholdRef.current = false;
                          }} />
                        <circle cx={cx} cy={cy} r={(showBig ? 4.5 : 2.5) * scale}
                          fill={showBig ? s.color : T.surface}
                          stroke={s.color} strokeWidth={1}
                          strokeOpacity={showBig ? 0.9 : 0.3}
                          fillOpacity={showBig ? 0.85 : 1}
                          pointerEvents="none" />
                      </g>
                    );
                  })}
                  {/* Putaway button on location nodes */}
                  {node.type === "location" && (node.data?.usage === "internal" || node.data?.usage === "transit") && (
                    <g onClick={e => { e.stopPropagation(); setPutawayLoc(node.id); }} style={{ cursor: "pointer" }}>
                      <rect x={sx + (NW - 28) * scale} y={sy + 4 * scale} width={24 * scale} height={16 * scale} rx={4 * scale}
                        fill={paCount > 0 ? T.violetSoft : T.surfaceRaised} stroke={T.violet} strokeWidth={0.7} strokeOpacity={paCount > 0 ? 0.6 : 0.2} />
                      <text x={sx + (NW - 16) * scale} y={sy + 13 * scale} fontSize={9 * Math.max(scale, 0.6)} fill={T.violet} textAnchor="middle" dominantBaseline="central" fontFamily="'IBM Plex Mono', monospace" fontWeight={600}>
                        ⇲{paCount > 0 ? paCount : ""}
                      </text>
                    </g>
                  )}
                  {/* TODO(brainstorm-needed): minimal storage-category surface added 2026-05-09.
                      Nested sub-location view, capacity-based putaway, and multi-level trees
                      are deferred pending a brainstorm pass with Brecht. See CLAUDE.md. */}
                  {node.type === "location" && node.data?.usage === "internal" && (node.data?.capacity_qty || node.data?.capacity_packages || node.data?.capacity || node.data?.storage_category_id) && (() => {
                    const cid = node.data?.storage_category_id;
                    const catName = cid ? ((data.storageCategories || []).find(c => c.id === cid)?.name || cid) : '';
                    const capQty = node.data?.capacity_qty ?? node.data?.capacity ?? 0;
                    const capPkg = node.data?.capacity_packages ?? 0;
                    const capStr = [capQty ? `${capQty}u` : '', capPkg ? `${capPkg}p` : ''].filter(Boolean).join('+');
                    return (
                      <text x={sx + (NW / 2) * scale} y={sy + (NH + 11) * scale}
                        fontSize={9 * Math.max(scale, 0.6)} fill={T.textDim} textAnchor="middle"
                        fontFamily="'IBM Plex Mono', monospace" pointerEvents="none" style={{ userSelect: "none" }}>
                        {catName}
                        {catName && capStr ? ' · ' : ''}
                        {capStr ? `cap ${capStr}` : ''}
                      </text>
                    );
                  })()}
                </g>
              );
            })}

            {/* CONNECT GHOST LINE */}
            {connect && (() => {
              const sn = data.nodes.find(n => n.id === connect.srcId);
              if (!sn || !svgRef.current) return null;
              const r = svgRef.current.getBoundingClientRect();
              const sp = nodePort(sn, connect.srcSide);
              const x1 = sp.x * scale + offset.x;
              const y1 = sp.y * scale + offset.y;
              const x2 = connect.mx - r.left, y2 = connect.my - r.top;
              return (
                <g pointerEvents="none">
                  <path d={`M${x1},${y1} L${x2},${y2}`} fill="none" stroke={T.accent} strokeWidth={2} strokeOpacity={0.7} strokeDasharray="6 3" />
                  <circle cx={x2} cy={y2} r={5} fill={T.accent} fillOpacity={0.85} />
                </g>
              );
            })()}

            {/* SNAP GUIDES */}
            {snapGuides.map((g, i) => g.orient === "v"
              ? <line key={i} x1={g.pos} y1={0} x2={g.pos} y2={2000} stroke="#ff5cb0" strokeWidth={1} strokeOpacity={0.7} pointerEvents="none" />
              : <line key={i} x1={0} y1={g.pos} x2={4000} y2={g.pos} stroke="#ff5cb0" strokeWidth={1} strokeOpacity={0.7} pointerEvents="none" />)}

            {/* LASSO RECTANGLE */}
            {lasso && svgRef.current && (() => {
              const r = svgRef.current.getBoundingClientRect();
              const x = Math.min(lasso.x0, lasso.x1) - r.left;
              const y = Math.min(lasso.y0, lasso.y1) - r.top;
              const w = Math.abs(lasso.x1 - lasso.x0);
              const h = Math.abs(lasso.y1 - lasso.y0);
              return (
                <rect x={x} y={y} width={w} height={h}
                  fill={T.accent} fillOpacity={0.06}
                  stroke={T.accent} strokeWidth={1} strokeOpacity={0.7}
                  strokeDasharray="4 2" pointerEvents="none" />
              );
            })()}
          </svg>

          {/* PLACEMENT MODE — ghost tile follows cursor */}
          {placement && placeMouse && (() => {
            const s = nodeStyles[placement.type] || nodeStyles.location;
            return (
              <div style={{ position: "fixed", left: placeMouse.x - (NW * scale) / 2, top: placeMouse.y - (NH * scale) / 2,
                            width: NW * scale, height: NH * scale, pointerEvents: "none", zIndex: 50,
                            background: T.surface, border: `2px dashed ${s.color}`, borderRadius: 5 * scale,
                            opacity: 0.7, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <span style={{ fontSize: 16, color: s.color }}>{s.icon}</span>
                <span style={{ fontSize: 11, color: T.textSoft, fontFamily: "'IBM Plex Mono', monospace" }}>
                  new {placement.type.replace(/_/g, " ")}
                </span>
              </div>
            );
          })()}
          {placement && (
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", padding: "4px 12px", background: T.accent, color: "#fff", borderRadius: 14, fontSize: 10, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.6px", textTransform: "uppercase", zIndex: 22, boxShadow: "0 2px 8px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 8 }}>
              <span>📍 Click to place {placement.type} · Esc to cancel</span>
            </div>
          )}

          {/* PAN MODE BADGE — visible only while Space is held */}
          {spaceDown && (
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", padding: "4px 10px", background: T.accent, color: "#fff", borderRadius: 14, fontSize: 10, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.6px", textTransform: "uppercase", zIndex: 22, boxShadow: "0 2px 8px rgba(0,0,0,0.2)", pointerEvents: "none" }}>
              ✋ Pan mode (Space)
            </div>
          )}

          {/* TIPS PANEL */}
          {showTips && (
            <div style={{ position: "absolute", bottom: 38, right: 8, zIndex: 30, background: `${T.surface}f4`, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", width: 240, backdropFilter: "blur(8px)", boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.text, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                Canvas controls
                <button onClick={() => setShowTips(false)} style={{ background: "none", border: "none", cursor: "pointer", color: T.textDim, fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
              </div>
              {[
                ["Ctrl+K  /  /", "Command palette"],
                ["Scroll wheel", "Zoom in / out"],
                ["Hold Space + drag", "Pan from anywhere"],
                ["Click + drag canvas", "Pan (or rubber-band w/ shift — todo)"],
                ["Drag node", "Move (4px threshold)"],
                ["Shift + click nodes", "Multi-select"],
                ["Ctrl + A", "Select all visible"],
                ["Arrow keys / Shift+Arrow", "Nudge 8px / 1px"],
                ["F", "Focus selection"],
                ["Esc", "Clear selection"],
                ["Del / Backspace", "Delete selection"],
                ["[ / ]", "Send back / bring forward"],
                ["Ctrl+[ / Ctrl+]", "Send to back / bring to front"],
                ["Ctrl+Z / Ctrl+Y", "Undo / Redo"],
                ["⊞ button", "Auto-layout nodes"],
                ["Fit button", "Fit all nodes in view"],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", color: T.accent, background: T.accentSoft, padding: "2px 5px", borderRadius: 3, whiteSpace: "nowrap" }}>{key}</span>
                  <span style={{ fontSize: 9, color: T.textSoft, textAlign: "right" }}>{desc}</span>
                </div>
              ))}
            </div>
          )}

          {/* LEGEND */}
          {/* MINIMAP */}
          {(() => {
            const visible = data.nodes.filter(n => !(hideUnused && n.type === "location" && !usedLocationIds.has(n.id)));
            if (visible.length === 0 || !svgRef.current) return null;
            const PADW = 60;
            const minX = Math.min(...visible.map(n => n.x)) - PADW;
            const minY = Math.min(...visible.map(n => n.y)) - PADW;
            const maxX = Math.max(...visible.map(n => n.x + NW)) + PADW;
            const maxY = Math.max(...visible.map(n => n.y + NH)) + PADW;
            const w = Math.max(40, maxX - minX), h = Math.max(40, maxY - minY);
            const MM_W = 160, MM_H = 100;
            const sx = MM_W / w, sy = MM_H / h, sm = Math.min(sx, sy);
            const offX = (MM_W - w * sm) / 2, offY = (MM_H - h * sm) / 2;
            const r = svgRef.current.getBoundingClientRect();
            const vpX = (-offset.x / scale - minX) * sm + offX;
            const vpY = (-offset.y / scale - minY) * sm + offY;
            const vpW = (r.width / scale) * sm;
            const vpH = (r.height / scale) * sm;
            const onMmClick = (e) => {
              const bb = e.currentTarget.getBoundingClientRect();
              const mx = e.clientX - bb.left, my = e.clientY - bb.top;
              const wx = (mx - offX) / sm + minX, wy = (my - offY) / sm + minY;
              setOffset({ x: r.width / 2 - wx * scale, y: r.height / 2 - wy * scale });
            };
            return (
              <div style={{ position: "absolute", bottom: 38, right: (sel && !putawayLoc) ? 340 : putawayLoc ? 410 : 8, width: MM_W, height: MM_H, background: `${T.surface}dd`, border: `1px solid ${T.border}`, borderRadius: 5, zIndex: 21, transition: "right 0.2s", overflow: "hidden", cursor: "crosshair" }} onMouseDown={onMmClick}>
                <svg width={MM_W} height={MM_H}>
                  {visible.map(n => {
                    const c = nodeStyles[n.type]?.color || T.textDim;
                    return <rect key={n.id} x={(n.x - minX) * sm + offX} y={(n.y - minY) * sm + offY} width={NW * sm} height={NH * sm} fill={c} fillOpacity={0.6} stroke="none" />;
                  })}
                  <rect x={vpX} y={vpY} width={vpW} height={vpH} fill={T.accent} fillOpacity={0.06} stroke={T.accent} strokeWidth={1} pointerEvents="none" />
                </svg>
                <div style={{ position: "absolute", top: 2, left: 5, fontSize: 7, color: T.textDim, fontFamily: "'IBM Plex Mono', monospace", textTransform: "uppercase", letterSpacing: "0.5px", pointerEvents: "none" }}>map</div>
              </div>
            );
          })()}
          <div style={{ position: "absolute", bottom: 8, right: (sel && !putawayLoc) ? 340 : putawayLoc ? 410 : 8, padding: "6px 10px", background: `${T.surface}dd`, border: `1px solid ${T.border}`, borderRadius: 5, zIndex: 20, display: "flex", gap: 10, fontSize: 8, color: T.textSoft, fontFamily: "'IBM Plex Mono', monospace", transition: "right 0.2s", flexWrap: "wrap", maxWidth: 720 }}>
            <span>◎ loc</span><span>⌂ wh</span>
            <span style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: 8 }}>
              <span style={{ color: T.amber }}>╌╌</span> op-group
            </span>
            <span style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: 8 }}>
              <span style={{ color: T.accent }}>━━</span> pull
            </span>
            <span><span style={{ color: T.accent, letterSpacing: -1 }}>━ ━</span> push</span>
            <span><span style={{ color: T.accent, letterSpacing: -1 }}>· · ·</span> pull+push</span>
            <span>$ buy</span><span>⚙ make</span>
            <span style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: 8 }}>● MTO · ○ MTS</span>
            <span style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: 8 }}>
              <span style={{ color: T.violet }}>⇲</span> putaway
            </span>
          </div>
        </div>

        {/* PROPERTY PANEL */}
        {sel && !putawayLoc && <PropPanel sel={sel} data={data}
          onUpdate={(type, id, upd) => {
            // Plan B: intercept wizard-managed warehouse flag edits.
            const WIZARD_FLAGS = ['reception_steps','delivery_steps','manufacture_to_resupply','manufacture_steps','buy_to_resupply','resupply_wh_ids'];
            if (type === 'warehouse' && upd && upd.data) {
              const item = data.nodes.find(n => n.id === id);
              const oldData = item?.data || {};
              const flagKey = WIZARD_FLAGS.find(k => k in upd.data && upd.data[k] !== oldData[k]);
              if (flagKey && tryWarehouseFlagEdit(id, flagKey, upd.data[flagKey])) {
                // Apply any other (non-wizard) data field edits via the normal path,
                // stripping the wizard flag key out of upd so it isn't double-applied.
                const otherKeys = Object.keys(upd.data).filter(k => k !== flagKey);
                if (otherKeys.length) {
                  const restData = {};
                  for (const k of otherKeys) restData[k] = upd.data[k];
                  doUpdate(type, id, { data: { ...oldData, ...restData } });
                }
                return;
              }
            }
            doUpdate(type, id, upd);
          }}
          onClose={() => setSel(null)} onDelete={doDelete} onSaveToOdoo={saveItemToOdoo} hasOdooSession={!!fetchedSnapshot} />}

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

      {/* HELP */}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {/* RIGHT-CLICK MENU */}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}

      {/* COMMAND PALETTE */}
      {paletteOpen && (() => {
        const cmds = [];
        // Add
        cmds.push(
          { id: "add-loc", group: "Add", label: "New Location", icon: "◎", color: T.green, hint: "Place anywhere · Esc cancels", run: () => doAdd("location") },
          { id: "add-wh", group: "Add", label: "New Warehouse", icon: "⌂", color: T.accent, hint: "Place anywhere · Esc cancels", run: () => doAdd("warehouse") },
          { id: "add-op", group: "Add", label: "New Operation Type", icon: "⛁", color: T.amber, run: () => doAdd("operation_type") },
          { id: "add-route", group: "Add", label: "New Route", icon: "⚡", color: T.sky, run: () => doAdd("route") },
        );
        // Templates
        for (const tpl of TEMPLATES) {
          cmds.push({ id: `tpl-${tpl.id}`, group: "Templates", label: `Template — ${tpl.name}`, icon: tpl.icon || "📋", hint: tpl.description, keywords: "template scenario " + tpl.id,
            run: () => {
              if (!confirm(`Replace current diagram with "${tpl.name}"?`)) return;
              setData(prev => {
                historyRef.current = [...historyRef.current.slice(-49), prev];
                futureRef.current = [];
                setCanUndo(true); setCanRedo(false);
                return tpl.build();
              });
              setSel(null); setMultiSel(new Set()); setFetchedSnapshot(null);
              setTimeout(() => { autoLayout(); fitToContent(); }, 50);
            }
          });
        }
        // View
        cmds.push(
          { id: "view-fit", group: "View", label: "Fit all to view", icon: "⊡", run: fitToContent },
          { id: "view-layout", group: "View", label: "Auto-layout nodes", icon: "⊞", run: autoLayout },
          { id: "view-theme", group: "View", label: isDark ? "Switch to light mode" : "Switch to dark mode", icon: isDark ? "☀" : "☾", run: () => setIsDark(d => !d) },
          { id: "view-hide", group: "View", label: hideUnused ? "Show unused locations" : "Hide unused locations", icon: hideUnused ? "👁" : "✕", run: () => setHideUnused(v => !v) },
          { id: "view-tips", group: "View", label: "Toggle canvas tips", icon: "ℹ", run: () => setShowTips(t => !t) },
          { id: "view-help", group: "View", label: "Help / Info", icon: "?", run: () => setHelpOpen(true) },
          { id: "view-compact", group: "View", label: compact ? "Expand toolbar" : "Compact toolbar (icons only)", icon: "⇲", run: () => setCompact(c => !c) },
        );
        // Edit (only when something selected)
        if (sel) {
          cmds.push(
            { id: "edit-front", group: "Edit", label: "Bring to front", icon: "⤒", hotkey: "Ctrl+]", run: () => zReorder("front") },
            { id: "edit-back",  group: "Edit", label: "Send to back",   icon: "⤓", hotkey: "Ctrl+[", run: () => zReorder("back")  },
            { id: "edit-fwd",   group: "Edit", label: "Bring forward",  icon: "↑",  hotkey: "]",      run: () => zReorder("fwd")   },
            { id: "edit-bwd",   group: "Edit", label: "Send backward",  icon: "↓",  hotkey: "[",      run: () => zReorder("bwd")   },
            { id: "edit-del",   group: "Edit", label: `Delete ${sel.type.replace(/_/g, " ")}`, icon: "✕", hotkey: "Del", run: () => doDelete(sel.type, sel.id) },
          );
        }
        // History
        cmds.push(
          { id: "hist-undo", group: "History", label: "Undo", icon: "↩", hotkey: "Ctrl+Z", run: undo },
          { id: "hist-redo", group: "History", label: "Redo", icon: "↪", hotkey: "Ctrl+Y", run: redo },
        );
        // File / Data
        cmds.push(
          { id: "data-export",  group: "Data", label: "Export as JSON", icon: "{ }", run: handleExport },
          { id: "data-svg",     group: "Data", label: "Export as SVG (vector)", icon: "✥", run: handleExportSvg },
          { id: "data-png",     group: "Data", label: "Export as PNG", icon: "▦", run: handleExportPng },
          { id: "data-pdf",     group: "Data", label: "Export as PDF (print)", icon: "▤", run: handleExportPdf },
          { id: "data-md",      group: "Data", label: "Export as Markdown", icon: "✎", run: handleExportMarkdown },
          { id: "data-import",  group: "Data", label: "Import JSON…",   icon: "⬆", run: () => importRef.current?.click() },
          { id: "data-fetch",   group: "Data", label: "Fetch from Odoo", icon: "⏬", hint: KONU_CFG ? `Connection: ${KONU_CFG.connectionName}` : "Uses configured credentials", run: handleFetchFromOdoo },
          { id: "data-push",    group: "Data", label: "Push to Odoo",    icon: "⏫", hint: fetchedSnapshot ? "Diff against last fetch" : "Fetch first to enable", run: handlePushToOdoo },
          { id: "data-api",     group: "Data", label: "Show API code",   icon: "{ }", run: () => setShowApi(true) },
        );
        // Settings
        if (!KONU_CFG) cmds.push({ id: "settings-conn", group: "Settings", label: "Configure Odoo connection", icon: "⚙", run: () => setShowCfg(true) });
        // Routes (jump-to)
        for (const r of data.routes) {
          cmds.push({ id: `goto-route-${r.id}`, group: "Go to Route", label: r.label, icon: "⚡", color: ROUTE_COLORS[r.colorIdx % ROUTE_COLORS.length].stroke,
                     hint: `${r.rules.length} rule${r.rules.length !== 1 ? "s" : ""}`, run: () => doSelect(r.id) });
        }
        return <CommandPalette commands={cmds} onClose={() => setPaletteOpen(false)} />;
      })()}

      {/* MODALS */}
      {showCfg && <CfgModal cfg={apiCfg} onChange={setApiCfg} onClose={() => setShowCfg(false)} />}
      {showCategoriesModal && <StorageCategoryModal
        categories={data.storageCategories || []}
        onUpdate={(items) => setData(p => {
          historyRef.current = [...historyRef.current.slice(-49), p];
          futureRef.current = [];
          setCanUndo(true); setCanRedo(false);
          return { ...p, storageCategories: items };
        })}
        onClose={() => setShowCategoriesModal(false)} />}
      {showTestPutaway && drillInto && <TestPutawayModal
        data={data} locationId={drillInto}
        simulate={simulatePutaway}
        onClose={() => setShowTestPutaway(false)} />}
      {showAdd && <AddModal onAdd={(type) => {
        if (type === 'warehouse') {
          setShowAdd(false);
          setShowWizard(true);
          return;
        }
        doAdd(type);
      }} routes={data.routes} onAddRule={addRuleToRoute} onApplyTemplate={(tpl, mode = "replace") => {
        const built = tpl.build();
        setData(prev => {
          historyRef.current = [...historyRef.current.slice(-49), prev];
          futureRef.current = [];
          setCanUndo(true); setCanRedo(false);
          if (mode === "replace") return built;
          // mode === "append": merge with id remapping, dedup shared semantic locations.
          const prefix = `t${Math.random().toString(36).slice(2, 6)}-`;
          // Pre-pass: shared-by-usage locations (Vendors/Customers) remap to existing canvas equivalents.
          const sharedMap = {};
          const findExistingByUsage = (usage) => prev.nodes.find(n => n.type === "location" && n.data?.usage === usage);
          for (const n of built.nodes) {
            if (n.type === "location" && (n.data?.usage === "supplier" || n.data?.usage === "customer")) {
              const existing = findExistingByUsage(n.data.usage);
              if (existing) sharedMap[n.id] = existing.id;
            }
          }
          const mapId = (id) => (id == null ? id : (sharedMap[id] || (prefix + id)));
          const remappedNodes = built.nodes
            .filter(n => !sharedMap[n.id])
            .map(n => ({ ...n, id: mapId(n.id) }));
          const remappedOps = (built.operationTypes || []).map(o => ({
            ...o, id: mapId(o.id),
            src_location_id: mapId(o.src_location_id),
            dest_location_id: mapId(o.dest_location_id),
          }));
          const remappedRoutes = (built.routes || []).map(r => ({
            ...r, id: mapId(r.id),
            rules: (r.rules || []).map(rl => ({
              ...rl, id: mapId(rl.id),
              src_location_id: mapId(rl.src_location_id),
              dest_location_id: mapId(rl.dest_location_id),
              picking_type_id: mapId(rl.picking_type_id),
            })),
          }));
          const remappedPutaway = (built.putawayRules || []).map(pr => ({
            ...pr, id: mapId(pr.id),
            location_in_id: mapId(pr.location_in_id),
          }));
          return {
            ...prev,
            nodes: [...prev.nodes, ...remappedNodes],
            operationTypes: [...(prev.operationTypes || []), ...remappedOps],
            routes: [...(prev.routes || []), ...remappedRoutes],
            putawayRules: [...(prev.putawayRules || []), ...remappedPutaway],
          };
        });
        setSel(null); setMultiSel(new Set()); setFetchedSnapshot(null);
        setTimeout(() => { autoLayout(); fitToContent(); }, 50);
      }} onClose={() => setShowAdd(false)} />}
      {showWizard && <WizardModal
        existingNodes={data.nodes}
        onClose={() => setShowWizard(false)}
        onSkip={() => { setShowWizard(false); doAdd('warehouse'); }}
        onCreate={(payload) => {
          setShowWizard(false);
          mergeWizardOutput(payload);
        }}
      />}
      {shrinkPending && <ShrinkDialog
        diff={shrinkPending.diff}
        warehouse={shrinkPending.warehouse}
        fieldLabel={shrinkPending.fieldLabel}
        oldValue={shrinkPending.oldValue}
        newValue={shrinkPending.newValue}
        onCancel={() => setShrinkPending(null)}
        onDelete={() => applyShrinkResolve('delete')}
        onDeactivate={() => applyShrinkResolve('deactivate')}
      />}
      {showApi && <ApiPanel data={data} apiConfig={apiCfg} onClose={() => setShowApi(false)} />}
      {showPushModal && <PushModal changes={showPushModal} onConfirm={executePush} onCancel={() => setShowPushModal(null)} />}
      {connectTarget && (() => {
        const sLabel = data.nodes.find(n => n.id === connectTarget.srcId)?.label || "?";
        const dLabel = data.nodes.find(n => n.id === connectTarget.dstId)?.label || "?";
        return (
          <ConnectModal srcLabel={sLabel} dstLabel={dLabel} routes={data.routes}
            onCreate={(routeId, action) => { addRuleWithEndpoints(routeId, connectTarget.srcId, connectTarget.dstId, action); setConnectTarget(null); }}
            onCreateInNewRoute={(action) => {
              const ts = Date.now();
              const newRouteId = `route-${ts}`;
              setData(p => {
                historyRef.current = [...historyRef.current.slice(-49), p];
                futureRef.current = [];
                setCanUndo(true); setCanRedo(false);
                return { ...p, routes: [...p.routes, { id: newRouteId, label: "New Route", colorIdx: p.routes.length % ROUTE_COLORS.length, data: { name: "New Route", active: true, product_selectable: false, product_categ_selectable: false, warehouse_selectable: true, sale_selectable: false }, rules: [] }] };
              });
              setTimeout(() => addRuleWithEndpoints(newRouteId, connectTarget.srcId, connectTarget.dstId, action), 30);
              setConnectTarget(null);
            }}
            onClose={() => setConnectTarget(null)} />
        );
      })()}
    </div>
  );
}
