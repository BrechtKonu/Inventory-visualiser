# Copyright (c) 2026 Konu Consulting BV. All rights reserved.
"""Catalog of Konu tools.

Every tool is a record so we can list them in the dashboard, gate them per
group, and add new ones (warehouse audit, route printer, putaway tester, …)
without changing core menus.
"""
from odoo import _, api, fields, models


class KonuTool(models.Model):
    _name = "konu.tool"
    _description = "Konu Tool"
    _order = "sequence, name"

    name = fields.Char(required=True, translate=True)
    technical_name = fields.Char(
        required=True,
        help="Slug; matches the URL segment under /konu_tools/<technical_name>/<connection_id>.",
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    description = fields.Text()
    icon = fields.Char(help="Single-character glyph or emoji shown on the kanban tile.")
    color = fields.Integer(default=0)
    group_ids = fields.Many2many(
        "res.groups", string="Restricted To",
        help="If set, only members of these groups see and use the tool.",
    )
    requires_connection = fields.Boolean(
        default=True,
        help="If set, the tool needs a customer connection to operate. "
             "Untick for tools that only act on Konu's own Odoo (e.g. internal reports).",
    )
    url_template = fields.Char(
        required=True,
        default="/konu_tools/{technical_name}/{connection_id}",
        help="URL pattern the tool launches under. {connection_id} is replaced "
             "at click time. Open in a new tab.",
    )

    _sql_constraints = [
        ("technical_name_uniq", "UNIQUE(technical_name)", "Tool technical name must be unique."),
    ]

    def open_for_connection(self, connection_id):
        self.ensure_one()
        url = self.url_template.format(
            technical_name=self.technical_name,
            connection_id=connection_id or 0,
        )
        return {"type": "ir.actions.act_url", "url": url, "target": "new"}
