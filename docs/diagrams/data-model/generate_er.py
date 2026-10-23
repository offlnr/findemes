"""Generate the data-model diagrams (Crow's Foot notation) and the data dictionary of Fin de Mes.

Reads the real schema from the local database (`docker compose up -d` and `pnpm db:migrate` first),
so the diagrams and the dictionary always match the migrations.

usage: python -I docs/diagrams/data-model/generate_er.py <repo_root>
outputs: docs/diagrams/data-model/datos-*.drawio, docs/data-dictionary.md, informe/diccionario-datos.html
"""
import html
import json
import os
import re
import subprocess
import sys

DATE = '21-10-2026'

# ---------------------------------------------------------------------------------------------
# Descriptions (Spanish). Everything structural comes from the database.
# ---------------------------------------------------------------------------------------------

MODULES = {
    'idn': ('Identidad y administración', '#1061B0'),
    'reg': ('Registro financiero', '#2E8B57'),
    'agg': ('Agregación bancaria', '#0E7C86'),
    'hog': ('Hogar', '#B8860B'),
    'sub': ('Suscripción y pagos', '#7B4FA0'),
    'scn': ('Escenarios', '#C0504D'),
    'aud': ('Auditoría', '#5B6770'),
}

TABLES = {
    'users': ('idn', 'Cuenta de usuario registrada. Base de la identidad y del control de acceso.',
              'HU17, HU17.1-HU17.4, HU23'),
    'consents': ('idn', 'Consentimientos otorgados por el usuario (términos, política de privacidad y conexión '
                 'bancaria) con la versión del documento aceptado. Retirar un consentimiento no borra el historial; '
                 'se elimina con la cuenta.', 'HU32, HU36, Ley 21.719'),
    'refresh_tokens': ('idn', 'Refresh tokens opacos y rotativos, guardados como hash SHA-256. Una familia agrupa '
                       'los tokens de un mismo inicio de sesión; reutilizar uno consumido revoca la familia.',
                       'HU17.1-HU17.3'),
    'email_tokens': ('idn', 'Enlaces de un solo uso enviados por correo (verificación 24 h, restablecimiento '
                     '30 min), guardados como hash SHA-256.', 'HU17, HU17.2'),
    'login_throttle': ('idn', 'Contadores del bloqueo temporal de inicio de sesión por cuenta y por IP. Las '
                       'claves son HMAC del correo normalizado o de la IP: no guarda datos personales en claro.',
                       'HU17.1'),
    'platform_admins': ('idn', 'Usuarios con rol de administrador de la plataforma y su segundo factor TOTP. '
                        'Solo la lee el rol de la API de administración.', 'HU22, RNF22'),
    'financial_profiles': ('reg', 'Saldo inicial del usuario al comienzo de un mes (uno por usuario).', 'HU04'),
    'incomes': ('reg', 'Ingresos recurrentes o esporádicos del usuario.', 'HU01'),
    'expenses': ('reg', 'Gastos fijos y gastos variables estimados del usuario.', 'HU02'),
    'debts': ('reg', 'Deuda en cuotas del usuario. Lo pendiente está en debt_installments.', 'HU03'),
    'debt_installments': ('reg', 'Calendario explícito de cuotas pendientes de una deuda: una fila por mes, lo que '
                          'también representa cuotas desiguales.', 'HU03'),
    'bank_links': ('agg', 'Vínculo con un banco a través de Fintoc (modo de prueba) o del banco de '
                   'demostración. Guarda el link_token cifrado con AES-256-GCM.', 'HU36, ADR-002'),
    'bank_accounts': ('agg', 'Cuentas bancarias obtenidas de un vínculo.', 'HU36'),
    'bank_movements': ('agg', 'Movimientos bancarios importados. Volver a sincronizar es idempotente.', 'HU36'),
    'households': ('hog', 'Hogar: espacio común compartido por sus miembros.', 'HU12'),
    'household_members': ('hog', 'Pertenencia de un usuario a un hogar y su rol. En el MVP, un usuario pertenece '
                          'como máximo a un hogar.', 'HU12, HU16'),
    'household_invitations': ('hog', 'Invitaciones de un solo uso a un hogar, guardadas como hash, con vigencia '
                              'máxima de 7 días.', 'HU12, HU31'),
    'household_expenses': ('hog', 'Gastos comunes del hogar, visibles para todos los miembros junto con quién los '
                           'registró.', 'HU13'),
    'contribution_rules': ('hog', 'Regla de aporte de cada gasto común: partes iguales, porcentajes o asignado a un '
                           'miembro.', 'HU14, HU15'),
    'contribution_shares': ('hog', 'Porcentaje de cada miembro cuando la regla es por porcentajes. La suma debe ser '
                            'exactamente 100 % (se verifica al confirmar la transacción).', 'HU14'),
    'plans': ('sub', 'Catálogo de planes del modelo freemium y sus límites (Tabla 13 del primer informe). Datos de referencia '
              'cargados por la migración.', 'HU18, HU30'),
    'subscriptions': ('sub', 'Período pagado vigente de un usuario. Sin fila, el usuario está en el plan gratuito. '
                      'El estado (Tabla 14 del primer informe) se deriva de las fechas; no se almacena.', 'HU19, HU20'),
    'payment_orders': ('sub', 'Órdenes de pago de Webpay Plus. buy_order único hace idempotente la activación. '
                       'Nunca se guardan datos de tarjeta.', 'HU19, HU26, RNF09'),
    'scenarios': ('scn', 'Escenario de simulación: nombre, referencia al estado base y decisiones. El estado base '
                  'nunca se copia, así que el escenario no puede alterarlo (regla 3).', 'HU06, HU07, HU09, HU11'),
    'audit_log': ('aud', 'Traza de auditoría de solo inserción, encadenada por hash: alterar o borrar una entrada '
                  'rompe la cadena y es detectable.', 'RNF10, RNF22, HU25'),
}

COMMON = {
    'id': 'Identificador único (UUID aleatorio, no secuencial).',
    'owner_id': 'Usuario dueño del registro. Toda lectura y escritura se filtra por este campo (RLS).',
    'created_at': 'Fecha y hora de creación.',
    'updated_at': 'Fecha y hora de la última modificación.',
    'label': 'Nombre que el usuario da al registro.',
    'amount': 'Monto en pesos chilenos (entero).',
    'schedule_kind': "Periodicidad: 'once' (un mes), 'monthly' (mensual) o 'every_n_months' (cada N meses).",
    'interval_months': "Cada cuántos meses se repite (2 a 24); solo con 'every_n_months'.",
    'from_month': 'Primer mes en que aplica.',
    'until_month': 'Último mes en que aplica; NULL = sin término.',
    'origin': "Origen del dato: 'real', 'provider_test' (modo de prueba del proveedor) o 'demo'. La app rotula "
              "lo que no es real.",
    'source_movement_id': 'Movimiento bancario desde el que el usuario confirmó el registro; NULL si es manual o si '
                          'se borró el dato bancario.',
    'token_hash': 'Hash SHA-256 del token; el token en claro nunca se guarda.',
    'expires_at': 'Fecha y hora de expiración.',
    'household_id': 'Hogar al que pertenece el registro.',
    'user_id': 'Usuario al que corresponde el registro.',
    'external_id': 'Identificador del registro en el proveedor bancario.',
    'plan_code': 'Plan contratado.',
}

COLUMNS = {
    'users': {
        'email': 'Correo, normalizado (sin espacios y en minúsculas). Único.',
        'password_hash': 'Hash argon2id de la contraseña (RNF07). La API de administración no puede leerlo.',
        'email_verified_at': 'Fecha y hora de verificación del correo; NULL = no verificado.',
        'status': "Estado de la cuenta: 'active' o 'suspended'. Solo un administrador lo cambia (HU23).",
        'onboarding_started_at': 'Inicio del registro inicial (KPI de finalización y tiempo de registro).',
        'onboarding_completed_at': 'Término del registro inicial: saldo inicial y al menos un ingreso (HU01, HU04).',
    },
    'consents': {
        'owner_id': 'Usuario que otorgó el consentimiento.',
        'kind': "Tipo: 'terms' (términos), 'privacy_policy' (política de privacidad) o 'bank_connection' "
                "(conexión bancaria).",
        'document_version': 'Versión del documento aceptado, por ejemplo 2026-10.',
        'accepted_at': 'Fecha y hora de aceptación.',
        'withdrawn_at': 'Fecha y hora de retiro; NULL = vigente. Solo un consentimiento vigente por tipo.',
    },
    'refresh_tokens': {
        'user_id': 'Usuario de la sesión.',
        'family_id': 'Familia de tokens de un mismo inicio de sesión.',
        'consumed_at': 'Fecha y hora en que se rotó; presentarlo de nuevo revoca la familia.',
        'revoked_at': 'Fecha y hora de revocación (cierre de sesión o reutilización detectada).',
    },
    'email_tokens': {
        'user_id': 'Usuario destinatario del enlace.',
        'purpose': "Uso del enlace: 'verify_email' o 'reset_password'.",
        'used_at': 'Fecha y hora de uso; un enlace usado no vuelve a servir.',
    },
    'login_throttle': {
        'key_hash': 'HMAC del correo normalizado o de la IP.',
        'failures': 'Intentos fallidos consecutivos.',
        'locked_until': 'Bloqueo temporal hasta esta fecha y hora; la espera crece con los fallos.',
    },
    'platform_admins': {
        'user_id': 'Usuario con rol de administrador.',
        'totp_secret_ciphertext': 'Secreto TOTP cifrado por la aplicación con AES-256-GCM.',
        'totp_nonce': 'Nonce de 12 bytes del cifrado AES-256-GCM.',
        'totp_key_version': 'Versión de la clave de cifrado usada (permite rotarla).',
        'last_login_at': 'Último inicio de sesión en el panel.',
    },
    'financial_profiles': {
        'owner_id': 'Usuario dueño del perfil (uno por usuario).',
        'opening_balance': 'Saldo inicial en pesos; puede ser negativo.',
        'balance_month': 'Mes al que corresponde el saldo inicial.',
        'source_account_id': 'Cuenta bancaria de la que se tomó el saldo; NULL si es manual.',
    },
    'expenses': {
        'nature': "Tipo de gasto: 'fixed' (fijo) o 'variable_estimate' (variable estimado).",
    },
    'debts': {
        'total_installments': 'Número total de cuotas informado al registrar (para mostrar "cuota 3 de 12").',
    },
    'debt_installments': {
        'debt_id': 'Deuda a la que pertenece la cuota.',
        'owner_id': 'Dueño; la clave compuesta asegura que coincide con el de la deuda.',
        'month': 'Mes de vencimiento de la cuota.',
        'amount': 'Monto de la cuota en pesos.',
    },
    'bank_links': {
        'provider': "Proveedor: 'fintoc' o 'demo'.",
        'provider_link_id': 'Identificador del vínculo en el proveedor.',
        'institution_name': 'Nombre del banco.',
        'token_ciphertext': 'link_token de Fintoc cifrado por la aplicación con AES-256-GCM.',
        'token_nonce': 'Nonce de 12 bytes del cifrado AES-256-GCM.',
        'token_key_version': 'Versión de la clave de cifrado usada (permite rotarla).',
        'status': "Estado del vínculo: 'active' o 'revoked'.",
        'last_synced_at': 'Última sincronización exitosa.',
    },
    'bank_accounts': {
        'link_id': 'Vínculo bancario del que proviene la cuenta.',
        'name': 'Nombre de la cuenta informado por el banco.',
        'account_type': 'Tipo de cuenta informado por el proveedor.',
        'available_balance': 'Saldo disponible en pesos.',
        'updated_at': 'Fecha y hora de la última actualización desde el proveedor.',
    },
    'bank_movements': {
        'account_id': 'Cuenta a la que pertenece el movimiento.',
        'posted_on': 'Fecha contable del movimiento.',
        'amount': 'Monto en pesos: negativo = cargo, positivo = abono. Nunca cero.',
        'description': 'Glosa del banco. Texto no confiable: siempre se escapa al mostrarlo.',
        'imported_at': 'Fecha y hora de importación.',
    },
    'households': {
        'name': 'Nombre del hogar.',
    },
    'household_members': {
        'user_id': 'Miembro del hogar (único: un hogar por usuario en el MVP).',
        'role': "Rol en el hogar: 'admin' o 'member'.",
        'display_name': 'Nombre visible para los demás miembros; el correo nunca se expone.',
        'joined_at': 'Fecha y hora de ingreso al hogar.',
    },
    'household_invitations': {
        'accepted_at': 'Fecha y hora de aceptación; una invitación aceptada no vuelve a servir.',
        'expires_at': 'Expiración; como máximo 7 días después de su creación.',
    },
    'household_expenses': {
        'created_by': 'Miembro que registró el gasto; NULL si eliminó su cuenta (HU21).',
        'created_by_name': "Nombre de quien lo registró, fijado por el servidor; pasa a 'Ex miembro' si se borra "
                           "su cuenta.",
    },
    'contribution_rules': {
        'expense_id': 'Gasto común al que aplica la regla (una regla por gasto).',
        'household_id': 'Hogar del gasto; la clave compuesta impide mezclar hogares.',
        'mode': "Modo de reparto: 'equal', 'percentage' o 'assigned'.",
        'assigned_user_id': "Miembro que asume el gasto; solo con 'assigned'. Debe ser miembro actual (trigger).",
    },
    'contribution_shares': {
        'expense_id': 'Gasto común.',
        'household_id': 'Hogar; la clave compuesta mantiene el porcentaje en el mismo hogar que la regla.',
        'user_id': 'Miembro que aporta. Debe ser miembro actual del hogar (trigger).',
        'basis_points': 'Porcentaje en puntos básicos enteros (10.000 = 100 %).',
    },
    'plans': {
        'code': "Código del plan: 'free', 'paid' o 'family'.",
        'name': 'Nombre visible del plan.',
        'price_clp': 'Precio por período en pesos; NULL = no está a la venta (el informe aún no fija precios).',
        'period_months': 'Duración del período pagado, en meses.',
        'max_saved_scenarios': 'Máximo de escenarios guardados; NULL = ilimitado.',
        'max_compared_scenarios': 'Máximo de escenarios comparables contra la base; NULL = ilimitado.',
        'full_history': 'Acceso al historial completo de meses.',
        'user_prepayments': 'Permite simular prepagos definidos por el usuario.',
        'household_space': 'Incluye el espacio común del hogar.',
    },
    'subscriptions': {
        'user_id': 'Usuario suscrito (una suscripción vigente por usuario).',
        'period_start': 'Inicio del período pagado (fecha de Chile).',
        'period_end': 'Fin del período pagado; luego el usuario vuelve al plan gratuito sin perder datos (HU20).',
        'cancel_at_period_end': 'El usuario canceló: conserva el acceso hasta period_end y no se renueva.',
    },
    'payment_orders': {
        'buy_order': 'Orden de compra enviada a Webpay. Única: confirmar dos veces no activa dos veces.',
        'user_id': 'Usuario que paga; NULL si eliminó su cuenta (se conserva para conciliar con Transbank).',
        'amount': 'Monto esperado según el plan.',
        'provider_token': 'token_ws de Webpay.',
        'status': "Resultado: 'created', 'authorized', 'rejected', 'aborted' o 'amount_mismatch'.",
        'authorized_amount': 'Monto informado por Transbank; se compara con amount.',
        'response_code': 'Código de respuesta de Transbank.',
        'committed_at': 'Fecha y hora del commit desde el servidor.',
        'activated_at': 'Fecha y hora en que se activó el plan; solo si status = authorized.',
    },
    'scenarios': {
        'name': 'Nombre del escenario.',
        'base_kind': "Estado base: 'personal' o 'household'.",
        'household_id': "Hogar cuyo estado se usa como base; solo con 'household'. Si el hogar desaparece o el "
                        "usuario sale, el escenario pasa a personal (trigger).",
        'decisions': 'Decisiones del escenario (arreglo JSON, máx. 20 y 64 KB). El núcleo las valida al simular.',
    },
    'audit_log': {
        'id': 'Identificador interno autoincremental.',
        'seq': 'Posición en la cadena, asignada por el trigger con bloqueo.',
        'occurred_at': 'Fecha y hora del evento, fijada por el servidor.',
        'actor_type': "Quién actuó: 'user', 'admin' o 'system'.",
        'actor_id': 'Identificador del actor. Sin clave foránea: sobrevive al borrado de la cuenta como seudónimo.',
        'action': "Acción realizada, p. ej. 'user.suspend'.",
        'target_type': 'Tipo de recurso afectado.',
        'target_id': 'Identificador del recurso afectado.',
        'origin_ip': 'IP de origen vista por la API (HU25).',
        'details': 'Detalle en JSON: solo identificadores y nombres de campos, nunca valores personales ni montos.',
        'prev_hash': 'Hash de la entrada anterior (encadenamiento).',
        'hash': 'Hash SHA-256 de esta entrada.',
    },
}

# Relationships enforced by triggers or deliberately without a foreign key.
LOGICAL = [
    ('contribution_rules', 'assigned_user_id', 'household_members', 'user_id',
     'Trigger: debe ser miembro actual del hogar.'),
    ('contribution_shares', 'user_id', 'household_members', 'user_id',
     'Trigger: debe ser miembro actual del hogar.'),
    ('audit_log', 'actor_id', 'users', 'id',
     'Sin clave foránea a propósito: la traza sobrevive al borrado de la cuenta (HU21).'),
]

TRIGGERS = {
    'audit_log_chain': 'Asigna seq, occurred_at, prev_hash y hash; el llamador no puede elegirlos.',
    'audit_log_no_update_delete': 'Rechaza toda modificación o borrado: la traza es de solo inserción.',
    'contribution_rules_members': 'El miembro asignado debe pertenecer actualmente al hogar.',
    'contribution_rules_total': 'Con modo porcentaje, los porcentajes deben sumar 100 % (al confirmar).',
    'contribution_shares_members': 'Cada miembro con porcentaje debe pertenecer actualmente al hogar.',
    'contribution_shares_total': 'Los porcentajes deben sumar 100 % (verificación diferida al confirmar).',
    'household_expenses_author': 'Fija el autor y su nombre desde el servidor e impide reescribirlos.',
    'household_members_removed': 'Al salir un miembro: sus reglas vuelven a partes iguales, un hogar vacío se '
                                 'elimina y, sin administrador, se promueve al miembro más antiguo.',
    'household_members_detach_scenarios': 'Al salir un miembro, sus escenarios basados en el hogar pasan a personales.',
    'households_detach_scenarios': 'Al eliminar un hogar, los escenarios basados en él pasan a personales.',
}

DOMAINS = [
    ('app.clp', 'bigint', 'Monto en pesos chilenos, entero, dentro del rango seguro de JavaScript (±2^53 − 1). '
     'Regla 10: sin decimales.'),
    ('app.month', 'date', 'Mes calendario, guardado como su primer día (CHECK: el valor es inicio de mes).'),
    ('app.label', 'text', 'Nombre dado por el usuario: entre 1 y 80 caracteres sin contar espacios extremos.'),
]

# ---------------------------------------------------------------------------------------------
# Schema extraction
# ---------------------------------------------------------------------------------------------

SCHEMA_SQL = r"""
SELECT json_build_object(
 'columns', (SELECT json_agg(json_build_object('t', c.relname, 'c', a.attname, 'n', a.attnum,
     'type', format_type(a.atttypid, a.atttypmod), 'nn', a.attnotnull,
     'def', pg_get_expr(d.adbin, d.adrelid), 'ident', a.attidentity <> '') ORDER BY c.relname, a.attnum)
   FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace s ON s.oid = c.relnamespace
   LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE s.nspname = 'app' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped),
 'constraints', (SELECT json_agg(json_build_object('t', c.conrelid::regclass::text, 'name', c.conname,
     'type', c.contype, 'def', pg_get_constraintdef(c.oid),
     'cols', (SELECT json_agg(a.attname ORDER BY k.i) FROM unnest(c.conkey) WITH ORDINALITY k(n, i)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n),
     'ref', CASE WHEN c.contype = 'f' THEN c.confrelid::regclass::text END,
     'refcols', (SELECT json_agg(a.attname ORDER BY k.i) FROM unnest(c.confkey) WITH ORDINALITY k(n, i)
                 JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n)) ORDER BY c.conname)
   FROM pg_constraint c JOIN pg_namespace s ON s.oid = c.connamespace
   WHERE s.nspname = 'app' AND c.conrelid <> 0),
 'indexes', (SELECT json_agg(json_build_object('t', t.relname, 'name', i.relname, 'unique', x.indisunique,
     'def', pg_get_indexdef(x.indexrelid)) ORDER BY i.relname)
   FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
   JOIN pg_namespace s ON s.oid = t.relnamespace
   WHERE s.nspname = 'app' AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)),
 'rls', (SELECT json_object_agg(c.relname, c.relrowsecurity) FROM pg_class c
   JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'app' AND c.relkind = 'r'),
 'policies', (SELECT json_agg(json_build_object('t', tablename, 'name', policyname, 'roles', roles, 'cmd', cmd)
   ORDER BY tablename, policyname) FROM pg_policies WHERE schemaname = 'app'),
 'grants', (SELECT json_agg(json_build_object('t', table_name, 'role', grantee, 'priv', privilege_type))
   FROM information_schema.role_table_grants WHERE table_schema = 'app' AND grantee IN ('app_api', 'app_admin')),
 'colgrants', (SELECT json_agg(json_build_object('t', table_name, 'role', grantee, 'priv', privilege_type,
     'c', column_name)) FROM information_schema.column_privileges
   WHERE table_schema = 'app' AND grantee IN ('app_api', 'app_admin')),
 'triggers', (SELECT json_agg(DISTINCT jsonb_build_object('t', event_object_table, 'name', trigger_name,
     'when', action_timing)) FROM information_schema.triggers WHERE trigger_schema = 'app')
)
"""


def load_schema(root):
    out = subprocess.run(['docker', 'compose', 'exec', '-T', 'db', 'psql', '-U', 'findemes_owner', '-d',
                          'findemes', '-At', '-v', 'ON_ERROR_STOP=1'], input=SCHEMA_SQL, cwd=root,
                         capture_output=True, text=True, encoding='utf-8', check=True)
    raw = json.loads(out.stdout)
    tables = {}
    for col in raw['columns']:
        tables.setdefault(col['t'], {'columns': [], 'constraints': [], 'indexes': [], 'triggers': [],
                                     'policies': []})['columns'].append(col)
    for con in raw['constraints']:
        tables[con['t'].removeprefix('app.')]['constraints'].append(con)
    for idx in raw['indexes'] or []:
        tables[idx['t']]['indexes'].append(idx)
    for trg in raw['triggers'] or []:
        if trg['name'] not in [x['name'] for x in tables[trg['t']]['triggers']]:
            tables[trg['t']]['triggers'].append(trg)
    for pol in raw['policies'] or []:
        tables[pol['t']]['policies'].append(pol)
    for name, t in tables.items():
        t['rls'] = raw['rls'][name]
        t['grants'] = {}
        for g in raw['grants'] or []:
            if g['t'] == name:
                t['grants'].setdefault(g['role'], set()).add(g['priv'])
        t['colgrants'] = {}
        for g in raw['colgrants'] or []:
            if g['t'] == name and g['priv'] not in t['grants'].get(g['role'], set()):
                t['colgrants'].setdefault((g['role'], g['priv']), []).append(g['c'])
        analyse(t)
    missing = set(tables) ^ set(TABLES)
    if missing:
        sys.exit('Tables without description or not in the database: %s' % sorted(missing))
    return tables


def analyse(t):
    t['pk'], t['uniques'], t['fks'], t['checks'] = [], [], [], []
    for con in t['constraints']:
        if con['type'] == 'p':
            t['pk'] = con['cols']
        elif con['type'] == 'u':
            t['uniques'].append(con['cols'])
        elif con['type'] == 'f':
            t['fks'].append(con)
        elif con['type'] == 'c':
            t['checks'].append(con)
    for idx in t['indexes']:
        if idx['unique']:
            cols = re.search(r'\((.*)\)', idx['def']).group(1).split(', ')
            t['uniques'].append(cols)
    nn = {c['c']: c['nn'] for c in t['columns']}
    for fk in t['fks']:
        fk['nullable'] = any(not nn[c] for c in fk['cols'])
        keys = [t['pk']] + t['uniques']
        fk['one_to_one'] = any(k and set(k) <= set(fk['cols']) for k in keys)
        names = [c for c in fk['cols'] if c not in ('owner_id', 'household_id')] or fk['cols']
        fk['col'] = names[0]
        fk['refcol'] = fk['refcols'][fk['cols'].index(fk['col'])]
        fk['ondelete'] = (re.search(r'ON DELETE ([A-Z ]+?)(?: \(|$)', fk['def']) or [None, 'NO ACTION'])[1]


def key_of(t, col):
    tags = []
    if col in t['pk']:
        tags.append('PK')
    if any(col in fk['cols'] for fk in t['fks']):
        tags.append('FK')
    if 'PK' not in tags and any(u == [col] for u in t['uniques']):
        tags.append('UK')
    return ','.join(tags)


def short_type(typ):
    return {'timestamp with time zone': 'timestamptz', 'app.clp': 'clp', 'app.month': 'month',
            'app.label': 'label', 'boolean': 'bool'}.get(typ, typ)


def pretty_check(d):
    d = re.sub(r'^CHECK \((.*)\)$', r'\1', d)
    d = re.sub(r"\(?(\w+) = ANY \(ARRAY\[(.*?)\]\)\)?", lambda m: '%s IN (%s)' % (m[1], m[2]), d)
    d = re.sub(r'::(text|bigint|integer|interval|jsonb|date)(\[\])?', '', d)
    d = re.sub(r'(?<!\w)\((\w+)\)', r'\1', d)
    while d.startswith('(') and d.endswith(')') and balanced(d[1:-1]):
        d = d[1:-1]
    return d


def balanced(s):
    depth = 0
    for ch in s:
        depth += (ch == '(') - (ch == ')')
        if depth < 0:
            return False
    return depth == 0


# ---------------------------------------------------------------------------------------------
# draw.io
# ---------------------------------------------------------------------------------------------

ROW_H, HEAD_H = 22, 30
EDGE = ('edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;html=1;strokeColor=#4D4D4D;strokeWidth=1.2;'
        'startFill=0;endFill=0;startSize=12;endSize=12;jumpStyle=arc;jumpSize=8;')
EDGE_LOGICAL = EDGE.replace('#4D4D4D', '#8C8C8C') + 'dashed=1;dashPattern=6 4;'
TEXT = 'text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;fontColor=#333333;fontSize=11;'


def e(s):
    return html.escape(str(s), quote=True)


class Page:
    def __init__(self):
        self.cells, self.n, self.rows, self.geo = [], 0, {}, {}

    def nid(self, p='c'):
        self.n += 1
        return '%s%d' % (p, self.n)

    def vertex(self, cid, value, style, x, y, w, h, parent='1'):
        self.cells.append('<mxCell id="%s" value="%s" style="%s" vertex="1" parent="%s"><mxGeometry x="%d" '
                          'y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
                          % (cid, e(value), style, parent, x, y, w, h))

    def edge(self, src, tgt, style, pts=()):
        points = ''.join('<mxPoint x="%d" y="%d"/>' % pt for pt in pts)
        self.cells.append('<mxCell id="%s" style="%s" edge="1" parent="1" source="%s" target="%s">'
                          '<mxGeometry relative="1" as="geometry">%s</mxGeometry></mxCell>'
                          % (self.nid('e'), style, src, tgt,
                             '<Array as="points">%s</Array>' % points if points else ''))

    def table(self, name, t, x, y, w, mode, column=0):
        """mode: 'full' (all columns), 'keys' (PK, FK and unique only), 'ref' (table from another view)."""
        module = TABLES[name][0]
        color = '#9AA3AA' if mode == 'ref' else MODULES[module][1]
        cols = t['columns']
        if mode == 'keys':
            cols = [c for c in cols if key_of(t, c['c']) or c['c'] in LOGICAL_COLS.get(name, ())]
        elif mode == 'ref':
            needed = REF_COLS.get(name, t['pk'])
            cols = [c for c in cols if c['c'] in needed]
        tid = 't_' + name
        title = 'app.%s' % name + ('  <span style="font-weight:normal;font-size:10px">(%s)</span>'
                                   % MODULES[module][0] if mode == 'ref' else '')
        self.vertex(tid, title, 'shape=table;startSize=%d;container=1;collapsible=0;childLayout=tableLayout;'
                    'fixedRows=1;rowLines=0;fontStyle=1;align=center;resizeLast=1;html=1;fontSize=12;'
                    'fillColor=%s;fontColor=#FFFFFF;strokeColor=%s;swimlaneFillColor=#FFFFFF;'
                    % (HEAD_H, color, color), x, y, w, HEAD_H + ROW_H * len(cols))
        kw, tw = 46, (110 if mode == 'keys' else 128)
        nw = w - kw - tw
        for i, c in enumerate(cols):
            rid = self.nid('r')
            self.rows[(name, c['c'])] = rid
            self.geo[rid] = (column, y + HEAD_H + ROW_H * i + ROW_H // 2)
            key = key_of(t, c['c'])
            pk = 'PK' in key
            self.vertex(rid, '', 'shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;'
                        'fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];'
                        'portConstraint=eastwest;top=0;left=0;right=0;bottom=%d;strokeColor=#D0D0D0;html=1;'
                        % (1 if pk and (i + 1 == len(cols) or 'PK' not in key_of(t, cols[i + 1]['c'])) else 0),
                        0, HEAD_H + ROW_H * i, w, ROW_H, tid)
            base = ('shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;'
                    'overflow=hidden;whiteSpace=wrap;html=1;fontSize=11;')
            weight = 'fontStyle=1;' if pk else ('fontStyle=2;fontColor=#707070;' if not c['nn'] else '')
            self.vertex(self.nid('k'), key, base + 'align=center;fontStyle=1;fontColor=#555555;fontSize=10;',
                        0, 0, kw, ROW_H, rid)
            self.vertex(self.nid('n'), c['c'], base + 'align=left;spacingLeft=6;' + weight, kw, 0, nw, ROW_H, rid)
            self.vertex(self.nid('y'), short_type(c['type']), base + 'align=left;spacingLeft=4;fontColor=#555555;'
                        'fontSize=10;', kw + nw, 0, tw, ROW_H, rid)
        return HEAD_H + ROW_H * len(cols)

    def relations(self, tables, shown, spans):
        """Orthogonal routes through lanes in the gaps between columns. A relation only joins tables in the
        same or in neighbouring columns, so no line crosses a table. Lines to the same key share a lane."""
        specs = []
        for name in shown:
            for fk in tables[name]['fks']:
                ref = fk['ref'].removeprefix('app.')
                src, tgt = self.rows.get((name, fk['col'])), self.rows.get((ref, fk['refcol']))
                if src and tgt:
                    many = 'ERzeroToOne' if fk['one_to_one'] else 'ERzeroToMany'
                    one = 'ERzeroToOne' if fk['nullable'] else 'ERmandOne'
                    specs.append((src, tgt, EDGE + 'startArrow=%s;endArrow=%s;' % (many, one)))
        for name, col, ref, refcol, _ in LOGICAL:
            src, tgt = self.rows.get((name, col)), self.rows.get((ref, refcol))
            if src and tgt:
                specs.append((src, tgt, EDGE_LOGICAL + 'startArrow=ERzeroToMany;endArrow=ERzeroToOne;'))

        def gap_of(src, tgt):
            cs, ct = self.geo[src][0], self.geo[tgt][0]
            if abs(cs - ct) > 1:
                sys.exit('Relation between non-adjacent columns: %s -> %s' % (src, tgt))
            if cs == ct:
                return ('right', cs), 1, 1
            return ('between', min(cs, ct)), (1 if cs < ct else 0), (0 if cs < ct else 1)

        buses = {}
        for src, tgt, style in specs:
            bus = (tgt, 'dashed' in style)
            buses.setdefault(gap_of(src, tgt)[0], {}).setdefault(bus, (self.geo[tgt][1], bus[1]))
        lane_x = {}
        for gap, targets in buses.items():
            kind, k = gap
            left = spans[k][1]
            right = spans[k + 1][0] if kind == 'between' else left + 40 + 22 * len(targets)
            order = sorted(targets, key=lambda b: targets[b])
            usable = right - left - 60
            for i, bus in enumerate(order):
                offset = usable * i / (len(order) - 1) if len(order) > 1 else usable / 2
                lane_x[(gap, bus)] = int(left + 30 + offset)
        for src, tgt, style in specs:
            gap, ex, nx = gap_of(src, tgt)
            lx = lane_x[(gap, (tgt, 'dashed' in style))]
            self.edge(src, tgt, style + 'exitX=%d;exitY=0.5;exitDx=0;exitDy=0;entryX=%d;entryY=0.5;entryDx=0;'
                      'entryDy=0;' % (ex, nx), [(lx, self.geo[src][1]), (lx, self.geo[tgt][1])])

    def legend(self, x, y, modules, logical=True):
        rows = [('ERmandOne', 'ERzeroToMany', 'Uno obligatorio a cero o muchos'),
                ('ERzeroToOne', 'ERzeroToMany', 'Cero o uno (FK opcional) a cero o muchos'),
                ('ERmandOne', 'ERzeroToOne', 'Uno a cero o uno (uno a uno)')]
        h = 44 + 30 * len(rows) + (30 if logical else 0) + 22 * len(modules) + 80
        self.vertex(self.nid('lg'), '', 'rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#BBBBBB;',
                    x, y, 360, h)
        self.vertex(self.nid('lt'), '<b>Notación (pata de gallo)</b>', TEXT, x + 12, y + 8, 330, 20)
        yy = y + 40
        for one, many, text in rows + ([('ERzeroToOne', 'ERzeroToMany', 'Relación lógica sin FK (trigger o '
                                                                     'seudónimo)')] if logical else []):
            a, b = self.nid('la'), self.nid('lb')
            self.vertex(a, '', 'point;strokeColor=none;fillColor=none;', x + 16, yy + 8, 1, 1)
            self.vertex(b, '', 'point;strokeColor=none;fillColor=none;', x + 106, yy + 8, 1, 1)
            style = (EDGE_LOGICAL if 'lógica' in text else EDGE) + 'startArrow=%s;endArrow=%s;' % (many, one)
            self.edge(b, a, style)
            self.vertex(self.nid('lx'), text, TEXT + 'fontSize=10;', x + 120, yy, 230, 20)
            yy += 30
        self.vertex(self.nid('lk'), '<b>PK</b> clave primaria · <b>FK</b> clave foránea · <b>UK</b> única<br>'
                    '<i style="color:#707070">cursiva</i> = admite NULL · clp, month y label son dominios '
                    '(ver diccionario)', TEXT + 'fontSize=10;', x + 12, yy, 340, 40)
        yy += 46
        for m in modules:
            name, color = MODULES[m]
            self.vertex(self.nid('lm'), '', 'rounded=0;html=1;fillColor=%s;strokeColor=none;' % color,
                        x + 16, yy + 4, 22, 13)
            self.vertex(self.nid('ln'), name, TEXT + 'fontSize=10;', x + 46, yy, 300, 20)
            yy += 22
        self.vertex(self.nid('lr'), '', 'rounded=0;html=1;fillColor=#9AA3AA;strokeColor=none;', x + 16, yy + 4,
                    22, 13)
        self.vertex(self.nid('ln'), 'Tabla de otra vista (solo columnas relacionadas)', TEXT + 'fontSize=10;',
                    x + 46, yy, 300, 20)

    def title(self, title, subtitle):
        self.vertex(self.nid('tt'), '<b style="font-size:18px">%s</b><br><span style="font-size:11px;'
                    'color:#555555">%s</span>' % (title, subtitle), TEXT, 40, 16, 1500, 50)

    def xml(self):
        return ('<mxfile host="generate_er.py"><diagram name="Página-1"><mxGraphModel dx="1600" dy="1000" '
                'grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" '
                'pageScale="1" math="0" shadow="0" adaptiveColors="auto"><root><mxCell id="0"/>'
                '<mxCell id="1" parent="0"/>%s</root></mxGraphModel></diagram></mxfile>\n'
                % ''.join(self.cells))


LOGICAL_COLS = {}
for _n, _c, _r, _rc, _ in LOGICAL:
    LOGICAL_COLS.setdefault(_n, set()).add(_c)
    LOGICAL_COLS.setdefault(_r, set()).add(_rc)

REF_COLS = {'users': ['id'], 'households': ['id'], 'bank_accounts': ['id', 'owner_id'],
            'household_members': ['household_id', 'user_id']}

SUBTITLE = 'Esquema app · PostgreSQL 18 · generado desde las migraciones 0001-0010 · ' + DATE

# Each view: file, title, mode, table width, gaps between columns, columns of tables (or (table, mode)).
# A relation may only join tables in the same or in neighbouring columns (checked when routing).
VIEWS = [
    ('datos-0-general', 'Modelo de datos · vista general (claves y relaciones)', 'keys', 280,
     [110, 110, 110, 220], [
        ['plans'],
        ['subscriptions', 'payment_orders', 'audit_log', 'refresh_tokens', 'email_tokens', 'platform_admins',
         'consents', 'login_throttle'],
        ['users'],
        ['financial_profiles', 'incomes', 'expenses', 'bank_links', 'debts', 'scenarios', 'household_members',
         'household_expenses'],
        ['bank_accounts', 'bank_movements', 'debt_installments', 'households', 'household_invitations',
         'contribution_rules', 'contribution_shares'],
    ]),
    ('datos-1-identidad', 'Modelo de datos · Identidad y administración', 'full', 380, [140, 140], [
        ['refresh_tokens', 'email_tokens'],
        ['users'],
        ['platform_admins', 'consents', 'login_throttle'],
    ]),
    ('datos-2-registro-y-agregacion', 'Modelo de datos · Registro financiero y agregación bancaria', 'full',
     380, [150, 170], [
        [('users', 'ref')],
        ['financial_profiles', 'incomes', 'expenses', 'bank_links', 'debts'],
        ['bank_accounts', 'bank_movements', 'debt_installments'],
    ]),
    ('datos-3-hogar', 'Modelo de datos · Hogar', 'full', 380, [140, 170], [
        [('users', 'ref')],
        ['household_members', 'household_expenses'],
        ['households', 'household_invitations', 'contribution_rules', 'contribution_shares'],
    ]),
    ('datos-4-suscripcion-escenarios-auditoria', 'Modelo de datos · Suscripción, escenarios y auditoría', 'full',
     380, [140, 140, 140], [
        ['plans'],
        ['subscriptions', 'payment_orders', 'audit_log'],
        [('users', 'ref'), ('households', 'ref')],
        ['scenarios'],
    ]),
    ('datos-completo', 'Modelo de datos · completo (todas las columnas)', 'full', 380,
     [120, 120, 120, 230], [
        ['plans'],
        ['subscriptions', 'payment_orders', 'audit_log', 'refresh_tokens', 'email_tokens', 'platform_admins',
         'consents', 'login_throttle'],
        ['users'],
        ['financial_profiles', 'incomes', 'expenses', 'bank_links', 'debts', 'scenarios', 'household_members',
         'household_expenses'],
        ['bank_accounts', 'bank_movements', 'debt_installments', 'households', 'household_invitations',
         'contribution_rules', 'contribution_shares'],
    ]),
]

GAP_Y = 46


def build_view(tables, title, mode, width, gaps, columns):
    p = Page()
    p.title(title, SUBTITLE)
    shown, modules, spans = [], [], []
    x = 40
    for k, col in enumerate(columns):
        y = 100
        for item in col:
            name, m = (item if isinstance(item, tuple) else (item, mode))
            h = p.table(name, tables[name], x, y, width, m, k)
            shown.append(name)
            if m != 'ref' and TABLES[name][0] not in modules:
                modules.append(TABLES[name][0])
            y += h + GAP_Y
        spans.append((x, x + width))
        x += width + (gaps[k] if k < len(gaps) else 0)
    p.relations(tables, shown, spans)
    p.legend(spans[-1][1] + 150, 100, [m for m in MODULES if m in modules],
             logical=any(n in shown and r in shown for n, _, r, _, _ in LOGICAL))
    return p.xml()


# ---------------------------------------------------------------------------------------------
# Data dictionary
# ---------------------------------------------------------------------------------------------

def access(t):
    out = {}
    for role in ('app_api', 'app_admin'):
        privs = sorted(t['grants'].get(role, set()))
        cols = {p: c for (r, p), c in t['colgrants'].items() if r == role}
        parts = [p for p in privs]
        parts += ['%s (%s)' % (p, ', '.join(sorted(c))) for p, c in sorted(cols.items())]
        out[role] = ', '.join(parts) if parts else 'sin acceso'
    return out


def column_rows(name, t):
    checks = {}
    for ch in t['checks']:
        if ch['cols'] and len(ch['cols']) == 1:
            checks.setdefault(ch['cols'][0], []).append(pretty_check(ch['def']))
    rows = []
    for c in t['columns']:
        desc = COLUMNS.get(name, {}).get(c['c']) or COMMON.get(c['c'], '')
        if not desc:
            sys.exit('Missing description for %s.%s' % (name, c['c']))
        default = 'identidad' if c['ident'] else (c['def'] or '').replace('::text', '').replace('::jsonb', '')
        rows.append([c['c'], c['type'].replace('timestamp with time zone', 'timestamptz'),
                     'No' if c['nn'] else 'Sí', default, key_of(t, c['c']), '; '.join(checks.get(c['c'], [])),
                     desc])
    return rows


def md_escape(s):
    return str(s).replace('|', '\\|')


def dictionary_md(tables):
    out = ['# Diccionario de datos · Fin de Mes', '',
           '> Generado por `docs/diagrams/data-model/generate_er.py` desde la base de datos con las migraciones 0001-0010 '
           'aplicadas (%s). No se edita a mano: se regenera cuando cambia una migración.' % DATE, '',
           'Esquema `app` de PostgreSQL 18. Diagramas: `docs/diagrams/data-model/datos-*.drawio.svg`. Decisiones de diseño, '
           'roles y Row-Level Security: `docs/adr/003-data-model-and-database-security.md`.', '',
           '## Convenciones', '',
           '- Identificadores UUID aleatorios (no secuenciales): un recurso ajeno responde 404 y los IDs no '
           'revelan volumen.',
           '- Montos en pesos chilenos como enteros (dominio `clp`), nunca punto flotante.',
           '- Fechas y horas en `timestamptz`; los meses del modelo financiero en el dominio `month`.',
           '- Ningún secreto en claro: tokens con hash SHA-256; `link_token` y secretos TOTP cifrados con '
           'AES-256-GCM por la aplicación; contraseñas con argon2id.',
           '- Dos roles de servicio: `app_api` (API pública, bajo RLS) y `app_admin` (API de administración, sin '
           'acceso a tablas financieras, HU23). Las migraciones usan un rol dueño con el que ningún servicio se '
           'conecta.',
           '- Las altas que deben respetar una regla (crear un escenario bajo el límite del plan, crear un hogar, '
           'aceptar una invitación, rotar un refresh token, activar un plan) pasan por funciones `SECURITY DEFINER` '
           'del esquema `app`; por eso algunas tablas no dan INSERT directo a `app_api`.', '',
           '## Dominios', '', '| Dominio | Tipo base | Regla |', '|---|---|---|']
    out += ['| `%s` | `%s` | %s |' % d for d in DOMAINS]
    out += ['', '## Resumen de tablas', '',
            '| Tabla | Módulo | Descripción | HU / RNF | RLS | app_api | app_admin |', '|---|---|---|---|---|---|---|']
    order = [n for m in MODULES for n in TABLES if TABLES[n][0] == m]
    for n in order:
        a = access(tables[n])
        out.append('| [`%s`](#%s) | %s | %s | %s | %s | %s | %s |' % (
            n, n.replace('_', '_'), MODULES[TABLES[n][0]][0], TABLES[n][1], TABLES[n][2],
            'Sí' if tables[n]['rls'] else 'No', md_escape(a['app_api']), md_escape(a['app_admin'])))
    for m in MODULES:
        out += ['', '## %s' % MODULES[m][0]]
        for n in [n for n in TABLES if TABLES[n][0] == m]:
            t = tables[n]
            a = access(t)
            out += ['', '### %s' % n, '', '%s Trazabilidad: %s.' % (TABLES[n][1], TABLES[n][2]), '',
                    '| Columna | Tipo | Nulo | Por defecto | Clave | Restricciones | Descripción |',
                    '|---|---|---|---|---|---|---|']
            for r in column_rows(n, t):
                out.append('| `%s` | `%s` | %s | %s | %s | %s | %s |' % (
                    r[0], r[1], r[2], ('`%s`' % md_escape(r[3])) if r[3] else '', r[4],
                    ('`%s`' % md_escape(r[5])) if r[5] else '', md_escape(r[6])))
            out += ['']
            out.append('- **Clave primaria:** %s' % (', '.join('`%s`' % c for c in t['pk']) or 'sin clave primaria'))
            for fk in t['fks']:
                out.append('- **Clave foránea:** (%s) → `%s` (%s), ON DELETE %s' % (
                    ', '.join('`%s`' % c for c in fk['cols']), fk['ref'].removeprefix('app.'),
                    ', '.join(fk['refcols']), fk['ondelete']))
            for u in t['uniques']:
                if u != t['pk']:
                    out.append('- **Única:** (%s)' % ', '.join('`%s`' % c for c in u))
            multi = [pretty_check(c['def']) for c in t['checks'] if not c['cols'] or len(c['cols']) > 1]
            for c in multi:
                out.append('- **Regla de fila:** `%s`' % md_escape(c))
            for i in t['indexes']:
                if not i['unique']:
                    cols = re.search(r'\((.*)\)', i['def']).group(1)
                    out.append('- **Índice:** `%s` (%s)' % (i['name'], cols))
            for trg in sorted(t['triggers'], key=lambda x: x['name']):
                out.append('- **Trigger** `%s`: %s' % (trg['name'], TRIGGERS.get(trg['name'], '')))
            for nm, col, ref, refcol, why in LOGICAL:
                if nm == n:
                    out.append('- **Relación lógica:** `%s` → `%s.%s`. %s' % (col, ref, refcol, why))
            pols = ', '.join('`%s` (%s, %s)' % (p['name'], p['cmd'], ','.join(p['roles']))
                             for p in t['policies'])
            out.append('- **RLS:** %s' % (('activa; políticas: ' + pols) if t['rls'] else 'no aplica'))
            out.append('- **Acceso:** `app_api`: %s · `app_admin`: %s' % (a['app_api'], a['app_admin']))
    out += ['', '## Pendientes del modelo', '',
            '- **Registro de consentimientos (Ley 21.719, HU32):** no hay tabla que guarde qué versión de los '
            'términos y de la política de privacidad aceptó cada usuario, ni el consentimiento para vincular su '
            'banco. Requiere decisión del equipo antes de crear la migración.', '']
    return '\n'.join(out)


def dictionary_html(tables):
    """Word-friendly version for the report: open in Word and copy the tables."""
    css = ('body{font-family:Calibri,Arial,sans-serif;font-size:10pt}table{border-collapse:collapse;width:100%;'
           'margin-bottom:6pt}th,td{border:1px solid #808080;padding:2pt 4pt;vertical-align:top}th{background:'
           '#D9E2F3}h2{font-size:13pt}h3{font-size:11pt;margin-bottom:2pt}p{margin:2pt 0}')
    out = ['<html><head><meta charset="utf-8"><title>Diccionario de datos</title><style>%s</style></head><body>'
           % css, '<h1>Diccionario de datos · Fin de Mes</h1>']
    out.append('<h2>Dominios</h2><table><tr><th>Dominio</th><th>Tipo base</th><th>Regla</th></tr>')
    out += ['<tr><td>%s</td><td>%s</td><td>%s</td></tr>' % tuple(e(x) for x in d) for d in DOMAINS]
    out.append('</table>')
    for m in MODULES:
        out.append('<h2>%s</h2>' % e(MODULES[m][0]))
        for n in [n for n in TABLES if TABLES[n][0] == m]:
            t = tables[n]
            out.append('<h3>Tabla %s</h3><p>%s Trazabilidad: %s.</p>' % (e(n), e(TABLES[n][1]), e(TABLES[n][2])))
            out.append('<table><tr><th>Columna</th><th>Tipo</th><th>Nulo</th><th>Clave</th><th>Descripción</th>'
                       '</tr>')
            for r in column_rows(n, t):
                rule = (' Restricción: %s.' % r[5]) if r[5] else ''
                default = (' Por defecto: %s.' % r[3]) if r[3] else ''
                out.append('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (
                    e(r[0]), e(r[1]), e(r[2]), e(r[4]), e(r[6] + default + rule)))
            out.append('</table>')
    out.append('</body></html>')
    return '\n'.join(out)


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    tables = load_schema(root)
    for fname, title, mode, width, gap, columns in VIEWS:
        with open(os.path.join(root, 'docs', 'diagrams', 'data-model', fname + '.drawio'), 'w', encoding='utf-8') as f:
            f.write(build_view(tables, title, mode, width, gap, columns))
    with open(os.path.join(root, 'docs', 'data-dictionary.md'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(dictionary_md(tables))
    informe = os.path.join(root, 'informe')
    if os.path.isdir(informe):
        with open(os.path.join(informe, 'diccionario-datos.html'), 'w', encoding='utf-8') as f:
            f.write(dictionary_html(tables))


if __name__ == '__main__':
    main()
