if(NOT DEFINED DRAKON_ROOT)
  message(FATAL_ERROR "DRAKON_ROOT is required")
endif()

set(DRAKON_INFERENCE_INDEX "${DRAKON_ROOT}/data/indexes/inference.jsonl")
if(NOT EXISTS "${DRAKON_INFERENCE_INDEX}")
  message(FATAL_ERROR "inference JSONL index was not created")
endif()

file(READ "${DRAKON_INFERENCE_INDEX}" DRAKON_INFERENCE_INDEX_CONTENT)
if(DRAKON_INFERENCE_INDEX_CONTENT STREQUAL "")
  message(FATAL_ERROR "inference JSONL index is empty")
endif()

foreach(DRAKON_REQUIRED_FIELD
    "\"record_type\":\"inference\""
    "\"inference_id\""
    "\"frame_id\""
    "\"camera_id\":\"cam_test_01\""
    "\"model_provider\":\"mock\""
    "\"mock\":true"
    "\"status\":\"mock\""
    "\"risk_score\""
    "\"result_path\"")
  string(FIND "${DRAKON_INFERENCE_INDEX_CONTENT}" "${DRAKON_REQUIRED_FIELD}" DRAKON_FIELD_OFFSET)
  if(DRAKON_FIELD_OFFSET EQUAL -1)
    message(FATAL_ERROR "inference JSONL index is missing ${DRAKON_REQUIRED_FIELD}")
  endif()
endforeach()

file(GLOB_RECURSE DRAKON_INFERENCE_RESULTS
  "${DRAKON_ROOT}/data/inference/cam_test_01/*.json"
)
if(NOT DRAKON_INFERENCE_RESULTS)
  message(FATAL_ERROR "inference result JSON was not created")
endif()
