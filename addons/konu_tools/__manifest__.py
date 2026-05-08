# Copyright (c) 2026 Konu Consulting BV. All rights reserved.
{
    "name": "Konu Tools",
    "version": "19.0.1.0.0",
    "category": "Tools",
    "summary": "Internal Konu utilities — central customer-connection registry, "
               "Inventory Visualiser, and shared tool catalog.",
    "description": """
Konu Tools
==========
Central registry of customer Odoo connections (URL, DB, login, API key) tied to
res.partner and project.project, with usage logging. Hosts the Inventory
Visualiser as a first-class tool. Connection records are reusable by
Konu's odoo-customer MCP server (KOTASK-065) so the same registry powers
both consultant tooling and Claude Code workflows.
""",
    "author": "Konu Consulting",
    "website": "https://konu.be",
    "license": "OPL-1",
    "depends": ["base", "mail", "project", "contacts", "web"],
    "external_dependencies": {"python": ["cryptography", "requests"]},
    "data": [
        "security/konu_tools_security.xml",
        "security/ir.model.access.csv",
        "data/konu_tool_data.xml",
        "views/konu_customer_connection_views.xml",
        "views/konu_tool_views.xml",
        "views/konu_tool_usage_log_views.xml",
        "views/menu.xml",
    ],
    # No backend assets in v1 — the visualiser opens in a new tab via act_url.
    # OWL client_action embedding is a future enhancement.
    "application": True,
    "installable": True,
}
