# Eligible-student search

The existing `/teacher-assignments` selector searches names and surnames with `q` inside its selected live subject/group context. Input is trimmed, bounded to 100 characters, and encoded literally; duplicate and structured search values are rejected. Empty search leaves the previous selector behavior unchanged.

A new search resets only the student offset. Context and patient coordinates remain independent; navigation and failed-POST recovery retain the search. A selected student absent from filtered results is cleared. Creation still sends the four existing backend fields using `student_habilitation_id`, not the student profile identifier. Search never becomes a mutation-body field.

Tests use synthetic API fixtures and compiled Astro markup, not a live backend, database, or browser. Other assignment-list and clinical-navigation integrations are separate work units.
