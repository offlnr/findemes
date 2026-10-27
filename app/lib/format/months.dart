/// Formato de meses `AAAA-MM` que entrega la API. Solo da formato (regla 8).
library;

const _names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

int _monthNumber(String month) => int.parse(month.substring(5, 7));

/// `2026-11` → `noviembre de 2026`.
String monthLong(String month) => '${_names[_monthNumber(month) - 1]} de ${month.substring(0, 4)}';

/// `2026-11` → `nov 2026`.
String monthShort(String month) => '${_names[_monthNumber(month) - 1].substring(0, 3)} ${month.substring(0, 4)}';

/// `2026-11` → `N` (inicial para los ejes de los gráficos).
String monthInitial(String month) => _names[_monthNumber(month) - 1].substring(0, 1).toUpperCase();

/// Mes calendario `AAAA-MM` de [date].
String monthOf(DateTime date) => '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}';

/// Meses para elegir en un formulario: desde [before] meses atrás hasta [after] meses adelante.
List<String> monthOptions(DateTime now, {int before = 12, int after = 36}) => [
      for (var i = -before; i <= after; i++) monthOf(DateTime(now.year, now.month + i)),
    ];
