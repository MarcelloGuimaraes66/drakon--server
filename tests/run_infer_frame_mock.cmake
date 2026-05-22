if(NOT DEFINED DRAKON_ROOT)
  message(FATAL_ERROR "DRAKON_ROOT is required")
endif()
if(NOT DEFINED DRAKON_SERVER)
  message(FATAL_ERROR "DRAKON_SERVER is required")
endif()
if(NOT DEFINED DRAKON_CONFIG)
  message(FATAL_ERROR "DRAKON_CONFIG is required")
endif()

file(GLOB_RECURSE DRAKON_FRAME_IMAGES
  "${DRAKON_ROOT}/data/frames/cam_test_01/*_cam_test_01_*.jpg"
)
if(NOT DRAKON_FRAME_IMAGES)
  message(FATAL_ERROR "canonical frame image was not created")
endif()

list(GET DRAKON_FRAME_IMAGES 0 DRAKON_FRAME_IMAGE)
execute_process(
  COMMAND "${DRAKON_SERVER}" infer-frame --config "${DRAKON_CONFIG}" --frame "${DRAKON_FRAME_IMAGE}"
  WORKING_DIRECTORY "${DRAKON_ROOT}"
  RESULT_VARIABLE DRAKON_INFER_RESULT
  OUTPUT_VARIABLE DRAKON_INFER_STDOUT
  ERROR_VARIABLE DRAKON_INFER_STDERR
)
if(NOT DRAKON_INFER_RESULT EQUAL 0)
  message(FATAL_ERROR
    "infer-frame mock failed\nstdout:\n${DRAKON_INFER_STDOUT}\nstderr:\n${DRAKON_INFER_STDERR}")
endif()
