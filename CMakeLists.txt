cmake_minimum_required(VERSION 3.22)

project(drakon_server
  VERSION 0.1.0
  DESCRIPTION "Drakon CLI/headless camera capture and inference server"
  LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(GNUInstallDirs)

find_package(SQLite3 REQUIRED)
find_package(OpenCV REQUIRED COMPONENTS core imgcodecs imgproc videoio)
find_package(PkgConfig REQUIRED)
pkg_check_modules(LIBAV REQUIRED IMPORTED_TARGET libavformat libavcodec libavutil libswscale)

add_library(drakon_core
  src/agents/agent.cpp
  src/alerts/alerts.cpp
  src/camera/capture.cpp
  src/camera/frame_writer.cpp
  src/config/config_loader.cpp
  src/database/sqlite_database.cpp
  src/events/events.cpp
  src/frame_store/frame_store.cpp
  src/inference/inference.cpp
  src/jobs/job_executor.cpp
  src/jobs/job_parser.cpp
  src/jobs/job_types.cpp
  src/runtime/redaction.cpp
  src/runtime/runtime_paths.cpp
)

target_include_directories(drakon_core PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(drakon_core PUBLIC cxx_std_23)
target_link_libraries(drakon_core PUBLIC
  SQLite::SQLite3
  ${OpenCV_LIBS}
  PkgConfig::LIBAV
)

if(MSVC)
  target_compile_options(drakon_core PRIVATE /W4)
else()
  target_compile_options(drakon_core PRIVATE
    -Wall
    -Wextra
    -Wpedantic
  )
endif()

add_executable(drakon-server
  src/main.cpp
)

target_link_libraries(drakon-server PRIVATE drakon_core)

if(MSVC)
  target_compile_options(drakon-server PRIVATE /W4)
else()
  target_compile_options(drakon-server PRIVATE
    -Wall
    -Wextra
    -Wpedantic
  )
endif()

enable_testing()

set(DRAKON_EXAMPLE_CONFIG
  ${CMAKE_CURRENT_SOURCE_DIR}/config/drakon-server.example.json
)
set(DRAKON_EXAMPLE_JOB
  ${CMAKE_CURRENT_SOURCE_DIR}/config/jobs/dry-run-job.example.json
)
set(DRAKON_PACKAGING_CONFIG
  ${CMAKE_CURRENT_SOURCE_DIR}/packaging/linux/drakon-server.json.example
)

add_test(NAME drakon_server_help
  COMMAND $<TARGET_FILE:drakon-server> --help
)

add_test(NAME drakon_server_version
  COMMAND $<TARGET_FILE:drakon-server> version
)

add_test(NAME drakon_server_validate_config
  COMMAND $<TARGET_FILE:drakon-server> validate-config --config ${DRAKON_EXAMPLE_CONFIG}
)

add_test(NAME drakon_server_prepare_runtime
  COMMAND $<TARGET_FILE:drakon-server> prepare-runtime --config ${DRAKON_EXAMPLE_CONFIG}
)

add_test(NAME drakon_server_check_deps
  COMMAND $<TARGET_FILE:drakon-server> check-deps
)

add_test(NAME drakon_server_db_init
  COMMAND $<TARGET_FILE:drakon-server> db-init --config ${DRAKON_EXAMPLE_CONFIG}
)

add_test(NAME drakon_server_db_status
  COMMAND $<TARGET_FILE:drakon-server> db-status --config ${DRAKON_EXAMPLE_CONFIG}
)
set_tests_properties(drakon_server_db_status PROPERTIES DEPENDS drakon_server_db_init)

add_test(NAME drakon_server_list_cameras
  COMMAND $<TARGET_FILE:drakon-server> list-cameras --config ${DRAKON_EXAMPLE_CONFIG}
)
set_tests_properties(drakon_server_list_cameras PROPERTIES DEPENDS drakon_server_db_init)

add_test(NAME drakon_server_capture_dry_run
  COMMAND $<TARGET_FILE:drakon-server> capture-test --config ${DRAKON_EXAMPLE_CONFIG} --camera-id cam_test_01 --seconds 1 --dry-run
)

add_test(NAME drakon_server_index_frames
  COMMAND $<TARGET_FILE:drakon-server> index-frames --config ${DRAKON_EXAMPLE_CONFIG}
)
set_tests_properties(drakon_server_index_frames PROPERTIES DEPENDS drakon_server_capture_dry_run)

add_test(NAME drakon_server_verify_frame_store
  COMMAND ${CMAKE_COMMAND}
    -DDRAKON_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
    -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/verify_frame_store.cmake
)
set_tests_properties(drakon_server_verify_frame_store PROPERTIES DEPENDS drakon_server_index_frames)

add_test(NAME drakon_server_validate_job
  COMMAND $<TARGET_FILE:drakon-server> validate-job --job ${DRAKON_EXAMPLE_JOB}
)

add_test(NAME drakon_server_run_job_dry_run
  COMMAND $<TARGET_FILE:drakon-server> run-job --job ${DRAKON_EXAMPLE_JOB} --dry-run --config ${DRAKON_EXAMPLE_CONFIG}
)
set_tests_properties(drakon_server_run_job_dry_run PROPERTIES DEPENDS drakon_server_validate_job)

add_test(NAME drakon_server_verify_jobs_index
  COMMAND ${CMAKE_COMMAND}
    -DDRAKON_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
    -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/verify_jobs_index.cmake
)
set_tests_properties(drakon_server_verify_jobs_index PROPERTIES DEPENDS drakon_server_run_job_dry_run)

add_test(NAME drakon_server_infer_frame_mock
  COMMAND ${CMAKE_COMMAND}
    -DDRAKON_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
    -DDRAKON_SERVER=$<TARGET_FILE:drakon-server>
    -DDRAKON_CONFIG=${DRAKON_EXAMPLE_CONFIG}
    -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/run_infer_frame_mock.cmake
)
set_tests_properties(drakon_server_infer_frame_mock PROPERTIES DEPENDS drakon_server_index_frames)

add_test(NAME drakon_server_infer_batch_mock
  COMMAND $<TARGET_FILE:drakon-server> infer-batch --config ${DRAKON_EXAMPLE_CONFIG} --frames-index ${CMAKE_CURRENT_SOURCE_DIR}/data/indexes/frames.jsonl
)
set_tests_properties(drakon_server_infer_batch_mock PROPERTIES DEPENDS drakon_server_infer_frame_mock)

add_test(NAME drakon_server_verify_inference_index
  COMMAND ${CMAKE_COMMAND}
    -DDRAKON_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
    -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/verify_inference_index.cmake
)
set_tests_properties(drakon_server_verify_inference_index PROPERTIES DEPENDS drakon_server_infer_batch_mock)

add_test(NAME drakon_server_seed_alert_fixture
  COMMAND ${CMAKE_COMMAND}
    -DDRAKON_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
    -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/seed_alert_inference.cmake
)
set_tests_properties(drakon_server_seed_alert_fixture PROPERTIES DEPENDS drakon_server_verify_inference_index)

add_test(NAME drakon_server_generate_alerts
  COMMAND $<TARGET_FILE:drakon-server> generate-alerts --config ${DRAKON_EXAMPLE_CONFIG}
)
set_tests_properties(drakon_server_generate_alerts PROPERTIES DEPENDS drakon_server_seed_alert_fixture)

add_test(NAME drakon_server_send_webhooks_dry_run
  COMMAND $<TARGET_FILE:drakon-server> send-webhooks --config ${DRAKON_EXAMPLE_CONFIG} --dry-run
)
set_tests_properties(drakon_server_send_webhooks_dry_run PROPERTIES DEPENDS drakon_server_generate_alerts)

add_test(NAME drakon_server_serve_api_plan
  COMMAND $<TARGET_FILE:drakon-server> serve-api --config ${DRAKON_EXAMPLE_CONFIG} --port 8077
)

add_test(NAME drakon_server_run_once
  COMMAND $<TARGET_FILE:drakon-server> run --config ${DRAKON_EXAMPLE_CONFIG} --once
)

add_test(NAME drakon_server_validate_packaging_config
  COMMAND $<TARGET_FILE:drakon-server> validate-config --config ${DRAKON_PACKAGING_CONFIG}
)

add_test(NAME drakon_server_verify_alerts_events_index
  COMMAND ${CMAKE_COMMAND}
    -DDRAKON_ROOT=${CMAKE_CURRENT_SOURCE_DIR}
    -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/verify_alerts_events_index.cmake
)
set_tests_properties(drakon_server_verify_alerts_events_index PROPERTIES DEPENDS drakon_server_send_webhooks_dry_run)

install(TARGETS drakon-server
  RUNTIME DESTINATION opt/drakon-server/bin
)

install(FILES
  packaging/linux/drakon-server.service
  DESTINATION lib/systemd/system
)

install(FILES
  packaging/linux/drakon-server.env.example
  packaging/linux/drakon-server.json.example
  DESTINATION etc/drakon-server
)

install(FILES
  README.md
  packaging/linux/INSTALL.md
  docs/auditoria-final.md
  DESTINATION usr/share/doc/drakon-server
)

install(DIRECTORY DESTINATION var/lib/drakon-server)
install(DIRECTORY DESTINATION var/log/drakon-server)

set(CPACK_GENERATOR "DEB")
set(CPACK_PACKAGE_NAME "drakon-server")
set(CPACK_PACKAGE_VENDOR "Drakon")
set(CPACK_PACKAGE_CONTACT "Marcello Guimaraes")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Drakon CLI/headless camera processing server")
set(CPACK_PACKAGE_VERSION ${PROJECT_VERSION})
set(CPACK_PACKAGING_INSTALL_PREFIX "/")
set(CPACK_DEBIAN_PACKAGE_MAINTAINER "Marcello Guimaraes")
set(CPACK_DEBIAN_PACKAGE_SECTION "video")
set(CPACK_DEBIAN_PACKAGE_PRIORITY "optional")
set(CPACK_DEBIAN_PACKAGE_SHLIBDEPS ON)
set(CPACK_DEBIAN_FILE_NAME DEB-DEFAULT)
include(CPack)
