# Copyright (c) 2026 Konu Consulting BV. All rights reserved.
"""Audit trail for every RPC call made through konu_tools.

Each row captures who did what against which customer, with enough detail
to reconstruct an incident (or a billable hour) later. Append-only; not
exposed for editing.
"""
from odoo import fields, models


class KonuToolUsageLog(models.Model):
    _name = "konu.tool.usage.log"
    _description = "Konu Tool Usage Log"
    _order = "create_date desc"
    _rec_name = "id"

    connection_id = fields.Many2one(
        "konu.customer.connection",
        required=True, ondelete="cascade", index=True,
    )
    tool_id = fields.Many2one("konu.tool", index=True)
    user_id = fields.Many2one("res.users", default=lambda s: s.env.user, required=True, index=True)
    timestamp = fields.Datetime(default=fields.Datetime.now, required=True)
    action = fields.Selection(
        [("rpc", "RPC call"), ("test", "Test connection"),
         ("open", "Open tool"), ("export", "Export"), ("push", "Push to customer")],
        default="rpc", required=True,
    )
    model_called = fields.Char(string="Odoo Model", index=True)
    method_called = fields.Char(string="Method")
    success = fields.Boolean(default=True)
    message = fields.Text()
