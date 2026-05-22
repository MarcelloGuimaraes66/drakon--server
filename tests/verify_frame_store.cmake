if(NOT DEFINED DRAKON_ROOT)
  message(FATAL_ERROR "DRAKON_ROOT is required")
endif()

file(GLOB_RECURSE DRAKON_FRAME_IMAGES
  "${DRAKON_ROOT}/data/frames/cam_test_01/*_cam_test_01_*.jpg"
)
if(NOT DRAKON_FRAME_IMAGES)
  message(FATAL_ERROR "canonical frame image was not created")
endif()

file(GLOB_RECURSE DRAKON_FRAME_METADATA
  "${DRAKON_ROOT}/data/frames/cam_test_01/frame_cam_test_01_*.json"
)
if(NOT DRAKON_FRAME_METADATA)
  message(FATAL_ERROR "canonical frame metadata sidecar was not created")
endif()

set(DRAKON_FRAME_INDEX "${DRAKON_ROOT}/data/indexes/frames.jsonl")
if(NOT EXISTS "${DRAKON_FRAME_INDEX}")
  message(FATAL_ERROR "frames JSONL index was not created")
endif()

file(READ "${DRAKON_FRAME_INDEX}" DRAKON_FRAME_INDEX_CONTENT)
if(DRAKON_FRAME_INDEX_CONTENT STREQUAL "")
  message(FATAL_ERROR "frames JSONL index is empty")
endif()

foreach(DRAKON_REQUIRED_FIELD
    "\"frame_id\""
    "\"camera_id\""
    "\"timestamp_utc\""
    "\"timestamp_local\""
    "\"fps_profile\""
    "\"image_path\""
    "\"metadata_path\""
    "\"width\""
    "\"height\""
    "\"source\""
    "\"checksum\"")
  string(FIND "${DRAKON_FRAME_INDEX_CONTENT}" "${DRAKON_REQUIRED_FIELD}" DRAKON_FIELD_OFFSET)
  if(DRAKON_FIELD_OFFSET EQUAL -1)
    message(FATAL_ERROR "frames JSONL index is missing ${DRAKON_REQUIRED_FIELD}")
  endif()
endforeach()

string(FIND "${DRAKON_FRAME_INDEX_CONTENT}" "_cam_test_01_" DRAKON_CANONICAL_NAME_OFFSET)
if(DRAKON_CANONICAL_NAME_OFFSET EQUAL -1)
  message(FATAL_ERROR "frames JSONL index does not reference canonical frame names")
endif()
