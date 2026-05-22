if(NOT DEFINED DRAKON_ROOT)
  message(FATAL_ERROR "DRAKON_ROOT is required")
endif()

set(DRAKON_ALERTS_INDEX "${DRAKON_ROOT}/data/indexes/alerts.jsonl")
set(DRAKON_EVENTS_INDEX "${DRAKON_ROOT}/data/indexes/events.jsonl")

if(NOT EXISTS "${DRAKON_ALERTS_INDEX}")
  message(FATAL_ERROR "alerts JSONL index was not created")
endif()
if(NOT EXISTS "${DRAKON_EVENTS_INDEX}")
  message(FATAL_ERROR "events JSONL index was not created")
endif()

file(READ "${DRAKON_ALERTS_INDEX}" DRAKON_ALERTS_CONTENT)
file(READ "${DRAKON_EVENTS_INDEX}" DRAKON_EVENTS_CONTENT)

foreach(DRAKON_REQUIRED_FIELD
    "\"record_type\":\"alert\""
    "\"alert_id\":\"alert_inf_fixture_alert_01_1\""
    "\"event_id\":\"event_inf_fixture_alert_01_alert_1\""
    "\"camera_id\":\"cam_test_01\""
    "\"severity\":\"high\""
    "\"delivery_status\""
    "\"recommended_action\":\"Review the frame.\"")
  string(FIND "${DRAKON_ALERTS_CONTENT}" "${DRAKON_REQUIRED_FIELD}" DRAKON_FIELD_OFFSET)
  if(DRAKON_FIELD_OFFSET EQUAL -1)
    message(FATAL_ERROR "alerts JSONL index is missing ${DRAKON_REQUIRED_FIELD}")
  endif()
endforeach()

foreach(DRAKON_REQUIRED_FIELD
    "\"record_type\":\"event\""
    "\"event_id\":\"event_inf_fixture_alert_01_alert_1\""
    "\"camera_id\":\"cam_test_01\""
    "\"event_type\":\"person_detected\""
    "\"inference_refs\""
    "\"alert_refs\"")
  string(FIND "${DRAKON_EVENTS_CONTENT}" "${DRAKON_REQUIRED_FIELD}" DRAKON_FIELD_OFFSET)
  if(DRAKON_FIELD_OFFSET EQUAL -1)
    message(FATAL_ERROR "events JSONL index is missing ${DRAKON_REQUIRED_FIELD}")
  endif()
endforeach()

file(GLOB_RECURSE DRAKON_ALERT_FILES
  "${DRAKON_ROOT}/data/alerts/2026/05/21/alert_inf_fixture_alert_01_1.json"
)
if(NOT DRAKON_ALERT_FILES)
  message(FATAL_ERROR "alert JSON file was not created")
endif()

file(GLOB_RECURSE DRAKON_EVENT_FILES
  "${DRAKON_ROOT}/data/events/2026/05/21/event_inf_fixture_alert_01_alert_1.json"
)
if(NOT DRAKON_EVENT_FILES)
  message(FATAL_ERROR "event JSON file was not created")
endif()
