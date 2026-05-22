if(NOT DEFINED DRAKON_ROOT)
  message(FATAL_ERROR "DRAKON_ROOT is required")
endif()

set(DRAKON_JOBS_INDEX "${DRAKON_ROOT}/data/indexes/jobs.jsonl")
if(NOT EXISTS "${DRAKON_JOBS_INDEX}")
  message(FATAL_ERROR "jobs JSONL index was not created")
endif()

file(READ "${DRAKON_JOBS_INDEX}" DRAKON_JOBS_INDEX_CONTENT)
if(DRAKON_JOBS_INDEX_CONTENT STREQUAL "")
  message(FATAL_ERROR "jobs JSONL index is empty")
endif()

foreach(DRAKON_REQUIRED_FIELD
    "\"record_type\":\"job_run\""
    "\"job_id\":\"job_dry_run_01\""
    "\"dry_run\":true"
    "\"runtime_status\":\"completed\""
    "\"steps_completed\""
    "\"agents\"")
  string(FIND "${DRAKON_JOBS_INDEX_CONTENT}" "${DRAKON_REQUIRED_FIELD}" DRAKON_FIELD_OFFSET)
  if(DRAKON_FIELD_OFFSET EQUAL -1)
    message(FATAL_ERROR "jobs JSONL index is missing ${DRAKON_REQUIRED_FIELD}")
  endif()
endforeach()
