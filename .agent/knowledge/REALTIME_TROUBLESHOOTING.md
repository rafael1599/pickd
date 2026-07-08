# Realtime Troubleshooting & Configuration

Instructions for maintaining and debugging Supabase Realtime in PickD.

## 📡 Enable Realtime in Supabase

Run this in the SQL Editor to ensure `picking_lists` is tracked:

```sql
-- Habilitar Realtime para picking_lists
ALTER PUBLICATION supabase_realtime ADD TABLE picking_lists;

-- Verificar
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND tablename = 'picking_lists';
```

## 🔍 Verification Checklist

- [ ] **Database Replication**: Ensure table is in `supabase_realtime` publication.
- [ ] **RLS Policies**: `SELECT` must be allowed for authenticated users.
- [ ] **WebSocket Connection**: Check DevTools -> Network -> WS. Status should be `101 Switching Protocols`.

## 🚨 Common Issues

- **Takeover not triggering**: Usually due to Realtime not being enabled for the table or RLS blocking the event.
- **WebSocket Disconnect**: The host/CDN may have timeouts. Users should refresh to reconnect.
- **Doble Modals**: Ensure `ErrorContext` and `Takeover` logic don't overlap.
