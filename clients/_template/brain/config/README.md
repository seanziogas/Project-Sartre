# Machine-readable brain configuration

Module-specific YAML belongs here when deterministic code consumes rules or templates that cannot safely be inferred from prose. Files use this envelope:

```yaml
version: 1
status: draft # draft | active | superseded
updated: YYYY-MM-DD
approved_by: ""
config:
  # Module-owned, schema-validated content.
```

The runner refuses draft, superseded, unattributed, or schema-invalid configuration. A GTME must review the corresponding brain document and this config before setting `status: active` and `approved_by`.
