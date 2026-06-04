cmake_minimum_required(VERSION 3.24)

project(PerceptrumLinux
    VERSION 1.0.0
    DESCRIPTION "Reproducible Linux build base for the Perceptrum runtime"
    LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(CTest)
include(GNUInstallDirs)

set(CMAKE_INSTALL_DEFAULT_DIRECTORY_PERMISSIONS
    OWNER_READ OWNER_WRITE OWNER_EXECUTE
    GROUP_READ GROUP_EXECUTE
    WORLD_READ WORLD_EXECUTE)

if(CMAKE_INSTALL_PREFIX_INITIALIZED_TO_DEFAULT OR CMAKE_INSTALL_PREFIX STREQUAL "/usr/local")
    set(CMAKE_INSTALL_PREFIX "/usr" CACHE PATH "Default Linux install prefix" FORCE)
endif()

find_package(CURL REQUIRED)
find_package(PkgConfig QUIET)
if(PkgConfig_FOUND)
    pkg_check_modules(WEBKITGTK QUIET IMPORTED_TARGET webkit2gtk-4.1)
endif()

set(PERCEPTRUM_WEBKITGTK_DEFAULT OFF)
if(WEBKITGTK_FOUND)
    set(PERCEPTRUM_WEBKITGTK_DEFAULT ON)
endif()

option(PERCEPTRUM_ENABLE_AGENT_CORE "Build the portable AgentCore foundation in the Linux runtime" OFF)
option(PERCEPTRUM_ENABLE_CAMERA_CAPTURE "Enable camera capture in Linux runtime" OFF)
option(PERCEPTRUM_ENABLE_RTSP_CAPTURE "Enable RTSP capture in Linux runtime" OFF)
option(PERCEPTRUM_ENABLE_JOB_RUNTIME "Enable JobRuntime in Linux runtime" OFF)
option(PERCEPTRUM_ENABLE_FRAME_WRITER "Enable FrameDiskWriter in Linux runtime" OFF)
option(PERCEPTRUM_BUILD_WEB "Run the shared DrakonSite web build before packaging the Linux desktop host" OFF)
option(PERCEPTRUM_ENABLE_WEBKITGTK "Build the Linux desktop host with a native WebKitGTK window" ${PERCEPTRUM_WEBKITGTK_DEFAULT})

if(PERCEPTRUM_ENABLE_WEBKITGTK AND NOT WEBKITGTK_FOUND)
    message(WARNING "webkit2gtk-4.1 was not found; perceptrum-desktop will fall back to xdg-open.")
    set(PERCEPTRUM_ENABLE_WEBKITGTK OFF)
endif()

set(PERCEPTRUM_WEB_SOURCE_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite"
    CACHE PATH "Shared React web source used by the Windows WebView2 host and Linux browser host")
set(PERCEPTRUM_WEB_DIST_DIR
    "${PERCEPTRUM_WEB_SOURCE_DIR}/dist"
    CACHE PATH "Shared built web assets to install with the Linux desktop package")
set(PERCEPTRUM_INSTALL_BINDIR "bin")
set(PERCEPTRUM_INSTALL_DATADIR "share")
set(PERCEPTRUM_LINUX_PACKAGE_PREFIX "${CMAKE_INSTALL_PREFIX}" CACHE PATH "Linux package install prefix")
set(PERCEPTRUM_LINUX_DEFAULT_WEB_ROOT
    "${PERCEPTRUM_LINUX_PACKAGE_PREFIX}/${PERCEPTRUM_INSTALL_DATADIR}/perceptrum-desktop/web")
set(PERCEPTRUM_LINUX_DEFAULT_BINDIR
    "${PERCEPTRUM_LINUX_PACKAGE_PREFIX}/${PERCEPTRUM_INSTALL_BINDIR}")
set(PERCEPTRUM_LINUX_BACKEND_RUNTIME_DIR
    "${CMAKE_CURRENT_BINARY_DIR}/linux-backend-runtime")
set(PERCEPTRUM_LINUX_DEFAULT_BACKEND_COMMAND
    "${PERCEPTRUM_LINUX_PACKAGE_PREFIX}/${PERCEPTRUM_INSTALL_DATADIR}/perceptrum-desktop/backend/perceptrum-local-backend.sh")
set(PERCEPTRUM_LINUX_APP_ICON
    "${PERCEPTRUM_WEB_SOURCE_DIR}/public/perceptrum_icon.png"
    CACHE FILEPATH "Perceptrum icon installed into the Linux icon theme")

add_library(perceptrum_core STATIC
    Perceptrum/comm/PairingClient.cpp
    Perceptrum/comm/PairingClient.h
    Perceptrum/core/AgentCoreStatus.cpp
    Perceptrum/core/AgentCoreStatus.h
    Perceptrum/platform/platform_common.cpp
    Perceptrum/platform/platform_process.cpp
    Perceptrum/platform/platform_secure_store.cpp
    Perceptrum/platform/platform_shutdown.cpp
    Perceptrum/runtime/BrandingRuntime.cpp
    Perceptrum/runtime/HeadlessService.cpp
    Perceptrum/runtime/HeadlessService.h
    Perceptrum/runtime/interfaces/AgentCoreStatusContract.h
    Perceptrum/runtime/interfaces/IAgentCoreStatusProvider.h
    Perceptrum/runtime/interfaces/IAgentRuntime.h
    Perceptrum/runtime/interfaces/IHeadlessRuntime.h
    Perceptrum/runtime/interfaces/IPairingConfigStore.h
    Perceptrum/runtime/interfaces/IRuntimeLogger.h
    Perceptrum/runtime/interfaces/ITokenStore.h
    Perceptrum/orchestrator/ConfigUtils.cpp
    Perceptrum/orchestrator/HttpUtils.cpp
    Perceptrum/jobs/JobPayloadParser.cpp
)

if(PERCEPTRUM_ENABLE_AGENT_CORE)
    target_sources(perceptrum_core
        PRIVATE
            Perceptrum/core/AgentCorePortable.cpp
            Perceptrum/core/AgentCorePortable.h)
endif()

target_include_directories(perceptrum_core
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/Perceptrum
)

target_link_libraries(perceptrum_core
    PUBLIC
        CURL::libcurl
)

target_compile_definitions(perceptrum_core
    PUBLIC
        PERCEPTRUM_LINUX_BUILD=1
        PERCEPTRUM_VERSION="${PROJECT_VERSION}"
        PERCEPTRUM_ENABLE_AGENT_CORE=0
        PERCEPTRUM_AGENT_CORE_PORTABLE_AVAILABLE=$<BOOL:${PERCEPTRUM_ENABLE_AGENT_CORE}>
        PERCEPTRUM_ENABLE_CAMERA_CAPTURE=$<BOOL:${PERCEPTRUM_ENABLE_CAMERA_CAPTURE}>
        PERCEPTRUM_ENABLE_RTSP_CAPTURE=$<BOOL:${PERCEPTRUM_ENABLE_RTSP_CAPTURE}>
        PERCEPTRUM_ENABLE_JOB_RUNTIME=$<BOOL:${PERCEPTRUM_ENABLE_JOB_RUNTIME}>
        PERCEPTRUM_ENABLE_FRAME_WRITER=$<BOOL:${PERCEPTRUM_ENABLE_FRAME_WRITER}>
)

add_executable(perceptrum-agent
    linux/main.cpp
    linux/LinuxHeadlessRuntime.cpp
    linux/RuntimePaths.cpp
    linux/LinuxRuntimeAdapters.cpp
    linux/LinuxRuntimeAdapters.h
    linux/LinuxJobRuntime.cpp
    linux/LinuxJobRuntime.h
    linux/LinuxRtspCandidateBuilder.cpp
    linux/LinuxRtspCandidateBuilder.h
    linux/LinuxCameraSessionManager.cpp
    linux/LinuxCameraSessionManager.h
    linux/LinuxFrameDiskWriter.cpp
    linux/LinuxFrameDiskWriter.h
    linux/LinuxRtspThumbnailProbe.cpp
    linux/LinuxRtspThumbnailProbe.h
)

target_link_libraries(perceptrum-agent
    PRIVATE
        perceptrum_core
)

add_executable(perceptrum-desktop
    linux-desktop/main.cpp
    linux/RuntimePaths.cpp
    linux-desktop/XdgPaths.cpp
)

target_link_libraries(perceptrum-desktop
    PRIVATE
        perceptrum_core
)

if(PERCEPTRUM_ENABLE_WEBKITGTK)
    target_link_libraries(perceptrum-desktop
        PRIVATE
            PkgConfig::WEBKITGTK)
    target_compile_definitions(perceptrum-desktop
        PRIVATE
            PERCEPTRUM_ENABLE_WEBKITGTK=1)
else()
    target_compile_definitions(perceptrum-desktop
        PRIVATE
            PERCEPTRUM_ENABLE_WEBKITGTK=0)
endif()

target_compile_definitions(perceptrum-desktop
    PRIVATE
        PERCEPTRUM_DEFAULT_WEB_ROOT="${PERCEPTRUM_LINUX_DEFAULT_WEB_ROOT}"
        PERCEPTRUM_DEFAULT_BACKEND_COMMAND="${PERCEPTRUM_LINUX_DEFAULT_BACKEND_COMMAND}"
)

if(PERCEPTRUM_BUILD_WEB)
    find_program(NPM_EXECUTABLE npm REQUIRED)
    add_custom_target(perceptrum-web-build
        COMMAND "${NPM_EXECUTABLE}" run build
        WORKING_DIRECTORY "${PERCEPTRUM_WEB_SOURCE_DIR}"
        COMMENT "Building shared DrakonSite web assets")
    add_dependencies(perceptrum-desktop perceptrum-web-build)
endif()

find_program(NODE_EXECUTABLE node REQUIRED)
add_custom_command(
    OUTPUT
        "${PERCEPTRUM_LINUX_BACKEND_RUNTIME_DIR}/desktop-local-server.cjs"
        "${PERCEPTRUM_LINUX_BACKEND_RUNTIME_DIR}/perceptrum-local-backend.sh"
        "${PERCEPTRUM_LINUX_BACKEND_RUNTIME_DIR}/bootstrap/perceptrum_site.seed.sqlite"
    COMMAND "${NODE_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/stage-backend-runtime.mjs"
        "--out"
        "${PERCEPTRUM_LINUX_BACKEND_RUNTIME_DIR}"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.."
    DEPENDS
        "${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/stage-backend-runtime.mjs"
        "${CMAKE_CURRENT_SOURCE_DIR}/../AppHost/Runtime/desktop-local-server.mjs"
        "${CMAKE_CURRENT_SOURCE_DIR}/../AppHost/Runtime/camera-discovery.mjs"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/server/index.ts"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/server/camera-discovery.ts"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/src/worker/index.ts"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/src/worker/cameraResourceAdmission.ts"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/src/worker/localAgentIngress.ts"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/src/worker/sharedCameraAccess.ts"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/src/worker/sharedFindRelayState.ts"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/src/worker/workspaceLocalState.ts"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/src/worker/workspaceRelayClient.ts"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/src/worker/workspaceRelayState.ts"
        "${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/scripts/convert-postgres-dump-to-sqlite.mjs"
    COMMENT "Staging Linux local backend runtime")
add_custom_target(perceptrum-linux-backend-runtime ALL
    DEPENDS
        "${PERCEPTRUM_LINUX_BACKEND_RUNTIME_DIR}/desktop-local-server.cjs"
        "${PERCEPTRUM_LINUX_BACKEND_RUNTIME_DIR}/perceptrum-local-backend.sh"
        "${PERCEPTRUM_LINUX_BACKEND_RUNTIME_DIR}/bootstrap/perceptrum_site.seed.sqlite")
add_dependencies(perceptrum-desktop perceptrum-linux-backend-runtime)

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../brand.config.json")
    add_custom_command(TARGET perceptrum-agent POST_BUILD
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${CMAKE_CURRENT_SOURCE_DIR}/../brand.config.json"
            "$<TARGET_FILE_DIR:perceptrum-agent>/brand.config.json")
    add_custom_command(TARGET perceptrum-desktop POST_BUILD
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${CMAKE_CURRENT_SOURCE_DIR}/../brand.config.json"
            "$<TARGET_FILE_DIR:perceptrum-desktop>/brand.config.json")
endif()

install(TARGETS perceptrum-agent perceptrum-desktop
    RUNTIME DESTINATION "${PERCEPTRUM_INSTALL_BINDIR}")

if(PERCEPTRUM_BUILD_WEB OR EXISTS "${PERCEPTRUM_WEB_DIST_DIR}/index.html")
    install(DIRECTORY "${PERCEPTRUM_WEB_DIST_DIR}/"
        DESTINATION "${PERCEPTRUM_INSTALL_DATADIR}/perceptrum-desktop/web")
else()
    message(WARNING
        "Shared web build not found at ${PERCEPTRUM_WEB_DIST_DIR}. "
        "Run npm run build in DrakonSite or configure PERCEPTRUM_BUILD_WEB=ON before packaging.")
endif()

set(PERCEPTRUM_LINUX_DESKTOP_FILE "${CMAKE_CURRENT_BINARY_DIR}/perceptrum.desktop")
set(PERCEPTRUM_LINUX_DESKTOP_LAUNCHER "${CMAKE_CURRENT_BINARY_DIR}/perceptrum-desktop-launcher.sh")
configure_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/perceptrum.desktop.in"
    "${PERCEPTRUM_LINUX_DESKTOP_FILE}"
    @ONLY)
configure_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/perceptrum-desktop-launcher.sh.in"
    "${PERCEPTRUM_LINUX_DESKTOP_LAUNCHER}"
    @ONLY)
install(FILES "${PERCEPTRUM_LINUX_DESKTOP_FILE}"
    DESTINATION "${PERCEPTRUM_INSTALL_DATADIR}/applications")
install(PROGRAMS "${PERCEPTRUM_LINUX_DESKTOP_LAUNCHER}"
    DESTINATION "${PERCEPTRUM_INSTALL_BINDIR}")
install(DIRECTORY "${PERCEPTRUM_LINUX_BACKEND_RUNTIME_DIR}/"
    DESTINATION "${PERCEPTRUM_INSTALL_DATADIR}/perceptrum-desktop/backend"
    FILE_PERMISSIONS
        OWNER_READ OWNER_WRITE
        GROUP_READ
        WORLD_READ
    DIRECTORY_PERMISSIONS
        OWNER_READ OWNER_WRITE OWNER_EXECUTE
        GROUP_READ GROUP_EXECUTE
        WORLD_READ WORLD_EXECUTE
    PATTERN "perceptrum-local-backend.sh"
        PERMISSIONS
            OWNER_READ OWNER_WRITE OWNER_EXECUTE
            GROUP_READ GROUP_EXECUTE
            WORLD_READ WORLD_EXECUTE
    PATTERN "*.node"
        PERMISSIONS
            OWNER_READ OWNER_WRITE OWNER_EXECUTE
            GROUP_READ GROUP_EXECUTE
            WORLD_READ WORLD_EXECUTE)
if(EXISTS "${PERCEPTRUM_LINUX_APP_ICON}")
    install(FILES "${PERCEPTRUM_LINUX_APP_ICON}"
        DESTINATION "${PERCEPTRUM_INSTALL_DATADIR}/icons/hicolor/1024x600/apps"
        RENAME "perceptrum.png")
endif()

set(PERCEPTRUM_CTEST_RUNTIME_ROOT "/tmp/perceptrum-ctest-runtime")

function(add_agent_env_test name)
    add_test(NAME "${name}"
        COMMAND "${CMAKE_COMMAND}" -E env
            "APP_RUNTIME_DATA_ROOT=${PERCEPTRUM_CTEST_RUNTIME_ROOT}/${name}/data"
            "APP_RUNTIME_CONFIG_ROOT=${PERCEPTRUM_CTEST_RUNTIME_ROOT}/${name}/config"
            "APP_RUNTIME_CACHE_ROOT=${PERCEPTRUM_CTEST_RUNTIME_ROOT}/${name}/cache"
            "APP_RUNTIME_STATE_ROOT=${PERCEPTRUM_CTEST_RUNTIME_ROOT}/${name}/state"
            "APP_RUNTIME_LOG_ROOT=${PERCEPTRUM_CTEST_RUNTIME_ROOT}/${name}/state/logs"
            $<TARGET_FILE:perceptrum-agent>
            ${ARGN})
endfunction()

add_agent_env_test(agent_help --help)
add_agent_env_test(agent_validate_config_tmp_runtime validate-config)
add_agent_env_test(agent_check_deps_tmp_runtime check-deps)
add_agent_env_test(agent_version version)

add_test(NAME agent_status_missing_snapshot
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_missing_snapshot' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_missing_snapshot/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_missing_snapshot/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_missing_snapshot/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_missing_snapshot/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_missing_snapshot/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_missing_snapshot/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_missing_snapshot/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_missing_snapshot/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_missing_snapshot/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' status; \
        code=$?; test \"$code\" -eq 3")

add_test(NAME agent_run_writes_health_snapshot
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot/state/logs' \
        timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
        test -f '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_writes_health_snapshot/data/agent_health.json'")

add_test(NAME agent_healthcheck_not_paired
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' run & \
        pid=$!; \
        sleep 1; \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_not_paired/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' healthcheck; \
        code=$?; \
        kill -TERM \"$pid\"; \
        wait \"$pid\" || true; \
        test \"$code\" -eq 2")

add_test(NAME agent_provision_requires_base_url
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_base_url' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_base_url/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_base_url/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_base_url/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_base_url/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_base_url/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_base_url/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_base_url/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_base_url/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_base_url/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision; \
        code=$?; test \"$code\" -eq 64")

add_test(NAME agent_provision_requires_token
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_token' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_token/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_token/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_token/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_token/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_token/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_token/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_token/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_token/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_token/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision --base-url http://127.0.0.1:4000; \
        code=$?; test \"$code\" -eq 64")

add_test(NAME agent_provision_requires_client_id
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_client_id' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_client_id/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_client_id/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_client_id/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_client_id/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_client_id/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_client_id/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_client_id/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_client_id/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_requires_client_id/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision --base-url http://127.0.0.1:4000 --exe-token TEST_TOKEN; \
        code=$?; test \"$code\" -eq 64")

add_test(NAME agent_provision_fails_closed_without_secret_store_when_token_needed
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed/state/logs' && \
        PATH=/nonexistent \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision --base-url http://127.0.0.1:4000 --exe-token TEST_TOKEN --client-id test-client; \
        code=$?; test \"$code\" -eq 5 && \
        test ! -f '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_fails_closed_without_secret_store_when_token_needed/config/secrets/exe_token.txt'")

add_test(NAME agent_provision_with_plaintext_recovery_flag_uses_0600_file
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file/state/logs' && \
        PATH=/nonexistent \
        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision --base-url http://127.0.0.1:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus && \
        test \"$(stat -c '%a' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_provision_with_plaintext_recovery_flag_uses_0600_file/config/secrets/exe_token.txt')\" = \"600\"")

add_test(NAME agent_status_after_provision_reads_config
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/state/logs' && \
        PATH=/nonexistent \
        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision --base-url http://127.0.0.1:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus && \
        PATH=/usr/bin:/bin \
        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_after_provision_reads_config/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' status | grep -q '\"client_id\": \"test-client\"'")

add_test(NAME pair_requires_pair_code
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_requires_pair_code' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_requires_pair_code/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_requires_pair_code/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_requires_pair_code/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_requires_pair_code/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_requires_pair_code/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_requires_pair_code/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_requires_pair_code/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_requires_pair_code/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_requires_pair_code/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' pair --base-url http://127.0.0.1:4000; \
        code=$?; test \"$code\" -eq 64")

add_test(NAME pair_backend_unreachable_is_functional_error
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_backend_unreachable_is_functional_error' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_backend_unreachable_is_functional_error/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_backend_unreachable_is_functional_error/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_backend_unreachable_is_functional_error/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_backend_unreachable_is_functional_error/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_backend_unreachable_is_functional_error/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_backend_unreachable_is_functional_error/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_backend_unreachable_is_functional_error/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_backend_unreachable_is_functional_error/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pair_backend_unreachable_is_functional_error/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' pair --pair-code TEST-CODE --base-url http://127.0.0.1:9 2>&1 | grep -q backend_unreachable")

add_test(NAME pairingclient_portable_backend_unreachable_uses_runtime_paths
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/state/logs' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/cwd' && \
        cd '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/cwd' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' pair --pair-code TEST-CODE --base-url http://127.0.0.1:9 \
            > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/pair.out' 2>&1; \
        code=$?; \
        test \"$code\" -eq 6 && \
        grep -q backend_unreachable '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/pair.out' && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/cwd/exe_token.txt' && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/cwd/client_id.txt' && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/cwd/exe_id.txt' && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/cwd/paired_timezone.txt' && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_backend_unreachable_uses_runtime_paths/config/secrets/exe_token.txt'")

add_test(NAME pairingclient_portable_pair_writes_runtime_paths
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/state/logs' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/cwd' && \
        node '${CMAKE_CURRENT_SOURCE_DIR}/linux/tests/mock_pairing_server.js' \
            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/port.txt' & \
        server=$!; \
        for i in $(seq 1 50); do test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/port.txt' && break; sleep 0.1; done; \
        port=$(cat '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/port.txt'); \
        cd '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/cwd' && \
        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' pair --pair-code TEST-CODE --base-url http://127.0.0.1:$port \
            > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/pair.out' 2>&1 && \
        grep -q 'paired client_id=test-client' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/pair.out' && \
        grep -q '\"client_id\": \"test-client\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/config/agent_config.json' && \
        grep -q '\"paired\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/config/agent_config.json' && \
        test \"$(stat -c '%a' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/config/secrets/exe_token.txt')\" = \"600\" && \
        grep -q TEST_TOKEN '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/config/secrets/exe_token.txt' && \
        ! grep -R TEST_TOKEN '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/data' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/state' 2>/dev/null && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/cwd/exe_token.txt' && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/cwd/client_id.txt' && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/cwd/exe_id.txt' && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/pairingclient_portable_pair_writes_runtime_paths/cwd/paired_timezone.txt'; \
        result=$?; \
        kill $server 2>/dev/null || true; \
        wait $server 2>/dev/null || true; \
        exit $result")

add_test(NAME agent_run_marks_stopped_on_sigterm
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' run & \
        pid=$!; sleep 1; kill -TERM \"$pid\"; wait \"$pid\"; \
        grep -q '\"status\": \"stopped\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_marks_stopped_on_sigterm/data/agent_health.json'")

add_test(NAME agent_run_reflects_provisioned_config
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/state/logs' && \
        PATH=/nonexistent APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision --base-url http://127.0.0.1:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus && \
        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' run & \
        pid=$!; sleep 1; kill -TERM \"$pid\"; wait \"$pid\"; \
        grep -q '\"provisioned\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_run_reflects_provisioned_config/data/agent_health.json'")

add_test(NAME agent_healthcheck_linux_minimal_when_provisioned_running
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/state/logs' && \
        PATH=/nonexistent APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision --base-url http://127.0.0.1:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus && \
        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' run & \
        pid=$!; sleep 1; \
        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_healthcheck_linux_minimal_when_provisioned_running/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' healthcheck 2>&1 | grep -q linux_minimal_runtime; \
        code=$?; kill -TERM \"$pid\"; wait \"$pid\" || true; test \"$code\" -eq 0")

add_test(NAME agent_status_shows_runtime_roots
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/state/logs' \
        timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' status | grep -q '\"cache_root\"' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' status | grep -q '\"state_root\"' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_shows_runtime_roots/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' status | grep -q '\"log_root\"'")

add_test(NAME agent_status_does_not_expose_secrets
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/state/logs' && \
        PATH=/nonexistent APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision --base-url http://127.0.0.1:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus && \
        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' status > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/status.txt' && \
        ! grep -q TEST_TOKEN '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_status_does_not_expose_secrets/status.txt'")

add_test(NAME agent_logs_created_in_log_root
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root/state/logs' \
        timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
        test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logs_created_in_log_root/state/logs/perceptrum-agent.log'")

add_test(NAME headless_bridge_reports_linux_minimal_runtime
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling/state/logs' \
        timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
        grep -q 'linux_minimal_runtime' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/headless_bridge_reports_platform_coupling/data/agent_health.json'")

add_test(NAME apphost_project_files_not_touched_by_linux_ctest
    COMMAND sh -c
        "test -z \"$(git -C '${CMAKE_CURRENT_SOURCE_DIR}/..' diff --name-only -- '*.vcxproj' '*.sln')\"")

add_test(NAME agent_logger_does_not_write_cwd_logs
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/state/logs' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/cwd' && \
        cd '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/cwd' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/state/logs' \
        timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
        test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/state/logs/perceptrum-agent.log' && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/cwd/logs/agent.log' && \
        test ! -e '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_logger_does_not_write_cwd_logs/cwd/logs/perceptrum-agent.log'")

add_test(NAME agent_health_does_not_expose_secrets
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets/state/logs' && \
        PATH=/nonexistent APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision --base-url http://127.0.0.1:4000 --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus && \
        ! grep -q TEST_TOKEN '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_does_not_expose_secrets/data/agent_health.json'")

add_test(NAME agent_health_redacts_sensitive_urls
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/state/logs' && \
        PATH=/nonexistent APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/state/logs' \
        '$<TARGET_FILE:perceptrum-agent>' provision --base-url 'http://baseuser:basepass@127.0.0.1:4000?access_token=BASE_ACCESS_TOKEN' --exe-token TEST_TOKEN --client-id test-client --timezone America/Manaus && \
        ! grep -q baseuser '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/data/agent_health.json' && \
        ! grep -q basepass '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/data/agent_health.json' && \
        ! grep -q BASE_ACCESS_TOKEN '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/data/agent_health.json' && \
        grep -F -q 'http://***:***@127.0.0.1:4000?access_token=****' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agent_health_redacts_sensitive_urls/data/agent_health.json'")

add_test(NAME linux_runtime_reports_interface_adapters
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/state/logs' \
        timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
        grep -q 'linux_runtime_logger_adapter' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/data/agent_health.json' && \
        grep -q 'linux_token_store_adapter' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/data/agent_health.json' && \
        grep -q 'linux_minimal_agent_runtime' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_runtime_reports_interface_adapters/data/agent_health.json'")

add_test(NAME headless_service_cpp_compiles_in_linux_core
    COMMAND sh -c
        "test -f '${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/perceptrum_core.dir/Perceptrum/runtime/HeadlessService.cpp.o'")

add_test(NAME pairingclient_portable_compiles_in_linux_core
    COMMAND sh -c
        "test -f '${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/perceptrum_core.dir/Perceptrum/comm/PairingClient.cpp.o' && \
        grep -q 'Perceptrum/comm/PairingClient.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja'")

add_test(NAME linux_minimal_runtime_feature_gates_off_by_default
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/state/logs' \
        timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
        grep -q '\"PERCEPTRUM_ENABLE_AGENT_CORE\": false' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/data/agent_health.json' && \
        grep -q '\"PERCEPTRUM_ENABLE_CAMERA_CAPTURE\": false' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/data/agent_health.json' && \
        grep -q '\"PERCEPTRUM_ENABLE_RTSP_CAPTURE\": false' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/data/agent_health.json' && \
        grep -q '\"PERCEPTRUM_ENABLE_JOB_RUNTIME\": false' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/data/agent_health.json' && \
        grep -q '\"PERCEPTRUM_ENABLE_FRAME_WRITER\": false' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_minimal_runtime_feature_gates_off_by_default/data/agent_health.json'")

add_test(NAME agentcore_lightweight_status_fields_reported
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/state/logs' \
        timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
        grep -q '\"agent_core_status_provider\": \"linux_minimal_agentcore_status_provider\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/data/agent_health.json' && \
        grep -q '\"agent_core_contract_version\": \"agentcore.status.v1\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/data/agent_health.json' && \
        grep -q '\"agent_core_partial\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/data/agent_health.json' && \
        grep -q '\"agent_core_blocked_reason\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/data/agent_health.json' && \
        grep -q '\"agent_core_config_source\": \"runtime_paths:agent_config.json\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/data/agent_health.json' && \
        grep -q '\"agent_core_capabilities\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_lightweight_status_fields_reported/data/agent_health.json'")

add_test(NAME agentcore_lightweight_status_compiles_in_linux_core
    COMMAND sh -c
        "test -f '${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/perceptrum_core.dir/Perceptrum/core/AgentCoreStatus.cpp.o' && \
        grep -q 'Perceptrum/core/AgentCoreStatus.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja'")

if(PERCEPTRUM_ENABLE_AGENT_CORE)
    add_test(NAME agentcore_portable_gate_compiles_without_legacy_sources
        COMMAND sh -c
            "test -f '${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/perceptrum_core.dir/Perceptrum/core/AgentCorePortable.cpp.o' && \
            grep -q 'Perceptrum/core/AgentCorePortable.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
            ! grep -q 'Perceptrum/core/AgentCore.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
            ! grep -q 'Perceptrum/camera/CameraSession.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
            ! grep -q 'Perceptrum/camera/FrameDiskWriter.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
            ! grep -q 'Perceptrum/jobs/JobRuntime.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja'")

    add_test(NAME agentcore_portable_gate_initializes_status
        COMMAND sh -c
            "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status' && \
            mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/data' \
                     '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/config' \
                     '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/cache' \
                     '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/state/logs' && \
            PERCEPTRUM_ENABLE_AGENT_CORE=1 \
            APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/data' \
            APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/config' \
            APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/cache' \
            APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/state' \
            APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/state/logs' \
            timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
            grep -q '\"runtime_mode\": \"linux_agentcore_portable\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/data/agent_health.json' && \
            grep -q '\"agent_core_enabled\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/data/agent_health.json' && \
            grep -q '\"agent_core_partial\": false' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/data/agent_health.json' && \
            grep -q '\"agent_core_status_provider\": \"linux_portable_agentcore_status_provider\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/data/agent_health.json' && \
            grep -q '\"agent_core_http_client\": \"linux_agentcore_curl_http_client\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_gate_initializes_status/data/agent_health.json'")

    if(PERCEPTRUM_ENABLE_JOB_RUNTIME)
    add_test(NAME agentcore_portable_job_runtime_gate_initializes
        COMMAND sh -c
            "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes' && \
            mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/data' \
                     '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/config' \
                     '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/cache' \
                     '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/state/logs' && \
            PERCEPTRUM_ENABLE_AGENT_CORE=1 \
            PERCEPTRUM_ENABLE_JOB_RUNTIME=1 \
            PERCEPTRUM_LINUX_LLM_PROVIDER=fake \
            APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/data' \
            APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/config' \
            APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/cache' \
            APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/state' \
            APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/state/logs' \
            timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
            grep -q '\"job_runtime_enabled\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/data/agent_health.json' && \
            grep -q '\"job_runtime_llm_provider\": \"fake\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/data/agent_health.json' && \
            grep -q '\"jobs_inference_temp_root\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/agentcore_portable_job_runtime_gate_initializes/data/agent_health.json'")
    endif()
endif()

add_test(NAME linux_unsupported_feature_gate_returns_functional_error
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/state/logs' && \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/state/logs' \
        PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
        '$<TARGET_FILE:perceptrum-agent>' run > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/stdout.txt' 2> '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/stderr.txt'; \
        code=$?; \
        test \"$code\" -eq 78 && \
        grep -q 'unsupported_feature_gate: PERCEPTRUM_ENABLE_CAMERA_CAPTURE' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/stderr.txt' && \
        grep -q '\"status\": \"feature_gate_unsupported\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/data/agent_health.json' && \
        grep -q '\"PERCEPTRUM_ENABLE_CAMERA_CAPTURE\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_unsupported_feature_gate_returns_functional_error/data/agent_health.json'")

add_test(NAME agentcore_complete_not_in_linux_target
    COMMAND sh -c
        "! grep -q 'Perceptrum/core/AgentCore.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
        ! grep -q 'Perceptrum/camera/CameraSession.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
        ! grep -q 'Perceptrum/camera/FrameDiskWriter.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
        ! grep -q 'Perceptrum/jobs/JobRuntime.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja'")

add_test(NAME linux_rtsp_thumbnail_adapter_compiles_without_legacy_sources
    COMMAND sh -c
        "test -f '${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/perceptrum-agent.dir/linux/LinuxRtspThumbnailProbe.cpp.o' && \
        grep -q 'linux/LinuxRtspThumbnailProbe.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
        ! grep -q 'Perceptrum/core/AgentCore.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
        ! grep -q 'Perceptrum/camera/CameraSession.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
        ! grep -q 'Perceptrum/camera/FrameDiskWriter.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja' && \
        ! grep -q 'Perceptrum/jobs/JobRuntime.cpp' '${CMAKE_CURRENT_BINARY_DIR}/build.ninja'")

if(PERCEPTRUM_ENABLE_CAMERA_CAPTURE AND PERCEPTRUM_ENABLE_RTSP_CAPTURE AND PERCEPTRUM_ENABLE_FRAME_WRITER)
add_test(NAME linux_rtsp_thumbnail_gates_generate_health_and_event
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/state/logs' && \
        APP_AGENT_RTSP_ALLOW_TEST_SOURCE=1 \
        APP_AGENT_RTSP_URL='lavfi:testsrc=size=96x54:rate=1' \
        APP_AGENT_CAMERA_ID='linux-rtsp-test' \
        APP_AGENT_CAMERA_NAME='Linux RTSP Test' \
        APP_AGENT_RECORDING_PROFILES='10,60,300' \
        APP_AGENT_RECORDING_CAPTURE_SECONDS=1 \
        PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
        PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
        PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/state/logs' \
        timeout 3s '$<TARGET_FILE:perceptrum-agent>' run || true; \
        grep -q '\"PERCEPTRUM_ENABLE_CAMERA_CAPTURE\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        grep -q '\"PERCEPTRUM_ENABLE_RTSP_CAPTURE\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        grep -q '\"PERCEPTRUM_ENABLE_FRAME_WRITER\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        grep -q '\"camera_capture_enabled\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        grep -q '\"rtsp_capture_enabled\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        grep -q '\"frame_writer_enabled\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        grep -q '\"rtsp_camera_started\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        grep -q '\"rtsp_thumbnail_generated\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        grep -q '\"camera_recording_clip_generated\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        grep -q '\"camera_recording_profiles\": \"10,60,300\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        grep -q '\"rtsp_event_published\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/agent_health.json' && \
        test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/cache/agentcore/camera-thumbnails/linux-rtsp-test-latest.jpg' && \
        test -n \"$(find '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/frames/cam_linux-rtsp-test' -name '*_10s.mp4' -size +0c -print -quit)\" && \
        test -n \"$(find '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/frames/cam_linux-rtsp-test' -name '*_60s.mp4' -size +0c -print -quit)\" && \
        test -n \"$(find '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/data/frames/cam_linux-rtsp-test' -name '*_300s.mp4' -size +0c -print -quit)\" && \
        grep -q 'linux_rtsp_thumbnail' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_rtsp_thumbnail_gates_generate_health_and_event/state/events/agent_events.jsonl'")
endif()

if(PERCEPTRUM_ENABLE_JOB_RUNTIME)
add_test(NAME linux_job_runtime_polls_commands_and_posts_fake_inference
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/config/secrets' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/state/logs' || exit 1; \
        node '${CMAKE_CURRENT_SOURCE_DIR}/linux/tests/mock_command_server.js' \
            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/port.txt' \
            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' & \
        server_pid=$!; \
        for i in 1 2 3 4 5 6 7 8 9 10; do test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/port.txt' && break; sleep 0.2; done; \
        port=$(cat '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/port.txt'); \
        printf '{\"schema_version\":1,\"base_url\":\"http://127.0.0.1:%s\",\"client_id\":\"test-client\",\"exe_id\":\"test-exe\",\"timezone\":\"UTC\",\"paired\":true,\"provisioned\":true}\\n' \"$port\" > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/config/agent_config.json'; \
        printf 'TEST_TOKEN\\n' > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/config/secrets/exe_token.txt'; \
	        APP_AGENT_RTSP_ALLOW_TEST_SOURCE=1 \
	        APP_AGENT_WEBCAM_TEST_SOURCE='lavfi:testsrc=size=96x54:rate=1' \
	        APP_AGENT_RECORDING_PROFILES='10' \
	        APP_AGENT_RECORDING_CAPTURE_SECONDS=1 \
        APP_AGENT_COMMAND_POLL_INTERVAL_MS=100 \
        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
        PERCEPTRUM_ENABLE_JOB_RUNTIME=1 \
        PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
        PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
        PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
        PERCEPTRUM_LINUX_LLM_PROVIDER=fake \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/state/logs' \
	        timeout 10s '$<TARGET_FILE:perceptrum-agent>' run || true; \
	        kill -TERM \"$server_pid\" 2>/dev/null || true; \
	        wait \"$server_pid\" 2>/dev/null || true; \
	        test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        grep -q '\"id\": 100' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        grep -q '\"connection_method\": \"WEBCAM\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        grep -q '\"thumbnail_uploaded\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        grep -q '\"id\": 101' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        grep -q '\"id\": 102' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        grep -q '\"camera_id\": 20' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        grep -q 'fake_local_inference_ok' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        grep -q '\"job_runtime_enabled\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/data/agent_health.json' && \
	        grep -q '\"input_artifacts\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        grep -q '\"latest_thumbnail\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        grep -q '\"event_type\": \"job_agent_completed\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/results.json' && \
	        test -n \"$(find '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/data/frames/cam_20' -name '*_10s.mp4' -size +0c -print -quit)\" && \
	        test -n \"$(find '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/data/frames/cam_22' -name '*_10s.mp4' -size +0c -print -quit)\" && \
	        test -n \"$(find '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_polls_commands_and_posts_fake_inference/cache/agentcore/jobs-inference-temp' -name 'job_23_command_101.json' -size +0c -print -quit)\"")

	add_test(NAME linux_job_runtime_real_provider_without_key_fails
	    COMMAND sh -c
	        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails' && \
	        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/data' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/config/secrets' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/cache' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/state/logs' || exit 1; \
	        node '${CMAKE_CURRENT_SOURCE_DIR}/linux/tests/mock_job_llm_missing_key_server.js' \
	            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/port.txt' \
	            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/results.json' & \
	        server_pid=$!; \
	        for i in 1 2 3 4 5 6 7 8 9 10; do test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/port.txt' && break; sleep 0.2; done; \
	        port=$(cat '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/port.txt'); \
	        printf '{\"schema_version\":1,\"base_url\":\"http://127.0.0.1:%s\",\"client_id\":\"test-client\",\"exe_id\":\"test-exe\",\"timezone\":\"UTC\",\"paired\":true,\"provisioned\":true}\\n' \"$port\" > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/config/agent_config.json'; \
	        printf 'TEST_TOKEN\\n' > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/config/secrets/exe_token.txt'; \
	        env -u OPENAI_API_KEY -u ZAI_API_KEY \
	        APP_AGENT_COMMAND_POLL_INTERVAL_MS=100 \
	        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
	        PERCEPTRUM_ENABLE_JOB_RUNTIME=1 \
	        PERCEPTRUM_LINUX_LLM_PROVIDER=openai \
	        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/data' \
	        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/config' \
	        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/cache' \
	        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/state' \
	        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/state/logs' \
	        timeout 6s '$<TARGET_FILE:perceptrum-agent>' run || true; \
	        kill -TERM \"$server_pid\" 2>/dev/null || true; \
	        wait \"$server_pid\" 2>/dev/null || true; \
	        test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/results.json' && \
	        grep -q '\"id\": 300' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/results.json' && \
	        grep -q '\"status\": \"failed\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/results.json' && \
	        grep -q 'missing_openai_api_key' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_without_key_fails/results.json'")

	add_test(NAME linux_job_runtime_real_provider_openai_manual
	    COMMAND sh -c
	        "test -n \"$OPENAI_API_KEY\" && \
	        rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual' && \
	        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/data' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/config/secrets' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/cache' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/state/logs' || exit 1; \
	        node '${CMAKE_CURRENT_SOURCE_DIR}/linux/tests/mock_command_server.js' \
	            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/port.txt' \
	            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/results.json' & \
	        server_pid=$!; \
	        for i in 1 2 3 4 5 6 7 8 9 10; do test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/port.txt' && break; sleep 0.2; done; \
	        port=$(cat '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/port.txt'); \
	        printf '{\"schema_version\":1,\"base_url\":\"http://127.0.0.1:%s\",\"client_id\":\"test-client\",\"exe_id\":\"test-exe\",\"timezone\":\"UTC\",\"paired\":true,\"provisioned\":true}\\n' \"$port\" > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/config/agent_config.json'; \
	        printf 'TEST_TOKEN\\n' > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/config/secrets/exe_token.txt'; \
	        APP_AGENT_RTSP_ALLOW_TEST_SOURCE=1 \
	        APP_AGENT_WEBCAM_TEST_SOURCE='lavfi:testsrc=size=96x54:rate=1' \
	        APP_AGENT_RECORDING_PROFILES='10' \
	        APP_AGENT_RECORDING_CAPTURE_SECONDS=1 \
	        APP_AGENT_COMMAND_POLL_INTERVAL_MS=100 \
	        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
	        PERCEPTRUM_ENABLE_JOB_RUNTIME=1 \
	        PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
	        PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
	        PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
	        PERCEPTRUM_LINUX_LLM_PROVIDER=openai \
	        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/data' \
	        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/config' \
	        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/cache' \
	        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/state' \
	        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/state/logs' \
	        timeout 25s '$<TARGET_FILE:perceptrum-agent>' run || true; \
	        kill -TERM \"$server_pid\" 2>/dev/null || true; \
	        wait \"$server_pid\" 2>/dev/null || true; \
	        test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/results.json' && \
	        grep -q '\"provider\": \"openai\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/results.json' && \
	        grep -q '\"network\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_real_provider_openai_manual/results.json'")
	set_tests_properties(linux_job_runtime_real_provider_openai_manual PROPERTIES DISABLED TRUE)

	add_test(NAME linux_agent_local_provision_polls_command_result_smoke
	    COMMAND sh -c
	        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke' && \
	        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/data' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/config' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/cache' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/state/logs' || exit 1; \
	        node '${CMAKE_CURRENT_SOURCE_DIR}/linux/tests/mock_command_server.js' \
	            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/port.txt' \
	            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/results.json' & \
	        server_pid=$!; \
	        for i in 1 2 3 4 5 6 7 8 9 10; do test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/port.txt' && break; sleep 0.2; done; \
	        port=$(cat '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/port.txt'); \
	        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
	        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/data' \
	        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/config' \
	        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/cache' \
	        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/state' \
	        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/state/logs' \
	        '$<TARGET_FILE:perceptrum-agent>' provision --base-url \"http://127.0.0.1:$port\" --exe-token TEST_TOKEN --client-id test-client --exe-id test-exe --timezone UTC && \
	        APP_AGENT_RTSP_ALLOW_TEST_SOURCE=1 \
	        APP_AGENT_WEBCAM_TEST_SOURCE='lavfi:testsrc=size=96x54:rate=1' \
	        APP_AGENT_RECORDING_PROFILES='10' \
	        APP_AGENT_RECORDING_CAPTURE_SECONDS=1 \
	        APP_AGENT_COMMAND_POLL_INTERVAL_MS=100 \
	        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
	        PERCEPTRUM_ENABLE_JOB_RUNTIME=1 \
	        PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
	        PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
	        PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
	        PERCEPTRUM_LINUX_LLM_PROVIDER=fake \
	        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/data' \
	        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/config' \
	        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/cache' \
	        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/state' \
	        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/state/logs' \
	        timeout 10s '$<TARGET_FILE:perceptrum-agent>' run || true; \
	        kill -TERM \"$server_pid\" 2>/dev/null || true; \
	        wait \"$server_pid\" 2>/dev/null || true; \
	        test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/results.json' && \
	        grep -q '\"id\": 100' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/results.json' && \
	        grep -q '\"id\": 101' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/results.json' && \
	        grep -q '\"id\": 102' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/results.json' && \
	        grep -q '\"status\": \"completed\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/results.json' && \
	        grep -q '\"job_runtime_enabled\": true' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_agent_local_provision_polls_command_result_smoke/data/agent_health.json'")

	add_test(NAME linux_job_runtime_rtsp_sources_and_invalid_candidate
	    COMMAND sh -c
	        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate' && \
	        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/data' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/config/secrets' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/cache' \
	                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/state/logs' || exit 1; \
	        ffmpeg -y -hide_banner -loglevel error -f lavfi -i testsrc=size=96x54:rate=5 -t 2 -pix_fmt yuv420p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/local-source.mp4' && \
	        PERCEPTRUM_TEST_FILE_SOURCE='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/local-source.mp4' \
	        node '${CMAKE_CURRENT_SOURCE_DIR}/linux/tests/mock_rtsp_command_server.js' \
	            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/port.txt' \
	            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/results.json' & \
	        server_pid=$!; \
	        for i in 1 2 3 4 5 6 7 8 9 10; do test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/port.txt' && break; sleep 0.2; done; \
	        port=$(cat '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/port.txt'); \
	        printf '{\"schema_version\":1,\"base_url\":\"http://127.0.0.1:%s\",\"client_id\":\"test-client\",\"exe_id\":\"test-exe\",\"timezone\":\"UTC\",\"paired\":true,\"provisioned\":true}\\n' \"$port\" > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/config/agent_config.json'; \
	        printf 'TEST_TOKEN\\n' > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/config/secrets/exe_token.txt'; \
	        APP_AGENT_RTSP_ALLOW_TEST_SOURCE=1 \
	        APP_AGENT_RECORDING_PROFILES='10' \
	        APP_AGENT_RECORDING_CAPTURE_SECONDS=1 \
	        APP_AGENT_COMMAND_POLL_INTERVAL_MS=100 \
	        APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 \
	        PERCEPTRUM_ENABLE_JOB_RUNTIME=1 \
	        PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
	        PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
	        PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
	        PERCEPTRUM_LINUX_LLM_PROVIDER=fake \
	        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/data' \
	        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/config' \
	        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/cache' \
	        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/state' \
	        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/state/logs' \
	        timeout 12s '$<TARGET_FILE:perceptrum-agent>' run || true; \
	        kill -TERM \"$server_pid\" 2>/dev/null || true; \
	        wait \"$server_pid\" 2>/dev/null || true; \
	        test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/results.json' && \
	        grep -q '\"id\": 200' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/results.json' && \
	        grep -q '\"id\": 201' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/results.json' && \
	        grep -q '\"id\": 202' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/results.json' && \
	        grep -q '\"camera_id\": \"30\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/results.json' && \
	        grep -q '\"camera_id\": \"31\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/results.json' && \
	        grep -q '\"status\": \"failed\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/results.json' && \
	        grep -Fq '\"active_rtsp_url\": \"rtsp://***:***@127.0.0.1:1/Streaming/Channels/101\"' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/results.json' && \
	        ! grep -q 'secretpass' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/results.json' && \
	        test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/cache/agentcore/camera-thumbnails/30-latest.jpg' && \
	        test -s '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_job_runtime_rtsp_sources_and_invalid_candidate/cache/agentcore/camera-thumbnails/31-latest.jpg'")
	endif()

if(PERCEPTRUM_ENABLE_CAMERA_CAPTURE AND PERCEPTRUM_ENABLE_RTSP_CAPTURE AND PERCEPTRUM_ENABLE_FRAME_WRITER)
add_test(NAME linux_camera_recordings_endpoint_lists_synthetic_segments
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments/state/logs' && \
        APP_AGENT_RTSP_ALLOW_TEST_SOURCE=1 \
        APP_AGENT_RTSP_URL='lavfi:testsrc=size=96x54:rate=1' \
        APP_AGENT_CAMERA_ID='22' \
        APP_AGENT_CAMERA_NAME='Linux Recording Endpoint Test' \
        APP_AGENT_RECORDING_PROFILES='10,60,300' \
        APP_AGENT_RECORDING_CAPTURE_SECONDS=1 \
        PERCEPTRUM_ENABLE_CAMERA_CAPTURE=1 \
        PERCEPTRUM_ENABLE_RTSP_CAPTURE=1 \
        PERCEPTRUM_ENABLE_FRAME_WRITER=1 \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments/state/logs' \
        timeout 8s '$<TARGET_FILE:perceptrum-agent>' run || true; \
        cd '${PERCEPTRUM_WEB_SOURCE_DIR}' && \
        './node_modules/.bin/tsx' --tsconfig tsconfig.worker.json \
            '../Perceptrum/linux/tests/verify_camera_recordings_endpoint.mjs' \
            '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_camera_recordings_endpoint_lists_synthetic_segments/data' \
            22")
endif()

add_test(NAME linux_desktop_uses_shared_web_build
    COMMAND "${CMAKE_COMMAND}" -E env
        "APP_STATIC_ROOT=${PERCEPTRUM_WEB_DIST_DIR}"
        $<TARGET_FILE:perceptrum-desktop>
        --print-web-root
        --no-open)
set_tests_properties(linux_desktop_uses_shared_web_build
    PROPERTIES PASS_REGULAR_EXPRESSION "webRoot=.*DrakonSite.*/dist")

add_test(NAME linux_desktop_launch_url_is_http_dashboard
    COMMAND "${CMAKE_COMMAND}" -E env
        "APP_STATIC_ROOT=${PERCEPTRUM_WEB_DIST_DIR}"
        "APP_BASE_URL=http://127.0.0.1:47831"
        $<TARGET_FILE:perceptrum-desktop>
        --print-web-root
        --no-open)
set_tests_properties(linux_desktop_launch_url_is_http_dashboard
    PROPERTIES PASS_REGULAR_EXPRESSION "launchUrl=http://127.0.0.1:47831/dashboard")

add_test(NAME linux_desktop_uses_webkitgtk_window_by_default_when_available
    COMMAND "${CMAKE_COMMAND}" -E env
        "APP_STATIC_ROOT=${PERCEPTRUM_WEB_DIST_DIR}"
        $<TARGET_FILE:perceptrum-desktop>
        --print-web-root
        --no-open)
if(PERCEPTRUM_ENABLE_WEBKITGTK)
    set_tests_properties(linux_desktop_uses_webkitgtk_window_by_default_when_available
        PROPERTIES PASS_REGULAR_EXPRESSION "windowMode=auto\nwebkitgtkCompiled=true")
else()
    set_tests_properties(linux_desktop_uses_webkitgtk_window_by_default_when_available
        PROPERTIES PASS_REGULAR_EXPRESSION "windowMode=auto\nwebkitgtkCompiled=false")
endif()

add_test(NAME linux_desktop_browser_fallback_mode_remains_available
    COMMAND "${CMAKE_COMMAND}" -E env
        "APP_STATIC_ROOT=${PERCEPTRUM_WEB_DIST_DIR}"
        "PERCEPTRUM_LINUX_WINDOW_MODE=browser"
        $<TARGET_FILE:perceptrum-desktop>
        --print-web-root
        --no-open)
set_tests_properties(linux_desktop_browser_fallback_mode_remains_available
    PROPERTIES PASS_REGULAR_EXPRESSION "windowMode=browser")

add_test(NAME linux_desktop_webkit_mode_can_be_requested
    COMMAND "${CMAKE_COMMAND}" -E env
        "APP_STATIC_ROOT=${PERCEPTRUM_WEB_DIST_DIR}"
        "PERCEPTRUM_LINUX_WINDOW_MODE=webkit"
        $<TARGET_FILE:perceptrum-desktop>
        --print-web-root
        --no-open)
set_tests_properties(linux_desktop_webkit_mode_can_be_requested
    PROPERTIES PASS_REGULAR_EXPRESSION "windowMode=webkitgtk")

add_test(NAME linux_desktop_webkit_bridge_script_present
    COMMAND sh -c
        "grep -q '__perceptrumLinuxWebKitBridgeInstalled' '${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/main.cpp' && \
        grep -q 'resident-runtime-session' '${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/main.cpp' && \
        grep -q 'theme-changed' '${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/main.cpp' && \
        grep -q 'account-delete-cleanup' '${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/main.cpp' && \
        grep -q 'perceptrumBridge' '${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/main.cpp'")

add_test(NAME linux_desktop_queries_agent_status
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/state/logs' && \
        APP_STATIC_ROOT='${PERCEPTRUM_WEB_DIST_DIR}' \
        PERCEPTRUM_AGENT_PATH='$<TARGET_FILE:perceptrum-agent>' \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/state/logs' \
        '$<TARGET_FILE:perceptrum-desktop>' --print-web-root --no-open \
        > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/output.txt' 2>&1 && \
        grep -q 'agentStatus=missing_snapshot' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_queries_agent_status/output.txt'")

add_test(NAME linux_desktop_local_session_uses_agent_provision
    COMMAND sh -c
        "grep -q 'ProvisionAgentFromLocalSession' '${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/main.cpp' && \
        grep -q 'perceptrum-agent provision' '${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/main.cpp' && \
        grep -q 'QueryAgentStatus(context.paths)' '${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop/main.cpp'")

add_test(NAME local_server_runtime_local_session_endpoint_present
    COMMAND sh -c
        "grep -q '/api/runtime/local-session' '${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/server/index.ts' && \
        grep -q 'handleRuntimeLocalSession' '${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/server/index.ts' && \
        grep -q '/api/pairing/generate' '${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/server/index.ts' && \
        grep -q '/api/pairing/pair' '${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/server/index.ts'")

add_test(NAME linux_desktop_rejects_file_launch_url
    COMMAND sh -c
        "APP_STATIC_ROOT='${PERCEPTRUM_WEB_DIST_DIR}' \
        PERCEPTRUM_DESKTOP_URL='file:///tmp/perceptrum/index.html' \
        '$<TARGET_FILE:perceptrum-desktop>' --print-web-root --no-open \
        > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_rejects_file_launch_url.txt' 2>&1; \
        code=$?; \
        test \"$code\" -eq 3 && \
        grep -q 'file:// is not supported' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_rejects_file_launch_url.txt'")

add_test(NAME linux_desktop_can_start_local_http_backend
    COMMAND sh -c
        "rm -rf '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend' && \
        mkdir -p '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/data' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/config' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/cache' \
                 '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/state/logs' && \
        APP_STATIC_ROOT='${PERCEPTRUM_WEB_DIST_DIR}' \
        APP_BASE_URL='http://127.0.0.1:47832' \
        PERCEPTRUM_BACKEND_COMMAND='node -e \"const http=require(\\\"http\\\"); const port=Number(process.env.PORT || 47832); const server=http.createServer((req,res)=>{ if(req.url===\\\"/__perceptrum/health\\\"){ res.writeHead(200,{\\\"content-type\\\":\\\"application/json\\\"}); res.end(\\\"{\\\\\\\"ok\\\\\\\":true}\\\"); return; } res.writeHead(200,{\\\"content-type\\\":\\\"text/html\\\"}); res.end(\\\"ok\\\"); }); server.listen(port,\\\"127.0.0.1\\\");\"' \
        APP_RUNTIME_DATA_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/data' \
        APP_RUNTIME_CONFIG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/config' \
        APP_RUNTIME_CACHE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/cache' \
        APP_RUNTIME_STATE_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/state' \
        APP_RUNTIME_LOG_ROOT='${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/state/logs' \
        '$<TARGET_FILE:perceptrum-desktop>' --check-backend --print-web-root \
        > '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/output.txt' 2>&1 && \
        grep -q 'backendStatus=started' '${PERCEPTRUM_CTEST_RUNTIME_ROOT}/linux_desktop_can_start_local_http_backend/output.txt'")

add_test(NAME linux_desktop_host_has_no_apphost_dependency
    COMMAND sh -c
        "! find '${CMAKE_CURRENT_SOURCE_DIR}/linux' '${CMAKE_CURRENT_SOURCE_DIR}/linux-desktop' \
        -type f \\( -name '*.cpp' -o -name '*.h' -o -name '*.in' \\) \
        -print0 | xargs -0 grep -E 'AppHost|WebView2|WinUI|Microsoft\\.UI'")

if(PERCEPTRUM_ENABLE_WEBKITGTK)
    add_test(NAME linux_desktop_links_webkitgtk
        COMMAND sh -c
            "ldd '$<TARGET_FILE:perceptrum-desktop>' | grep -E 'libwebkit2gtk|libgtk-3'")
endif()

add_test(NAME react_common_ui_has_no_winui_dependency
    COMMAND sh -c
        "! grep -R -E 'Microsoft\\.UI|WinUI|WebView2|C\\+\\+/WinRT|winrt/' '${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/src/react-app'")

add_test(NAME react_common_ui_has_no_gtk_dependency
    COMMAND sh -c
        "! grep -R -E 'WebKitGTK|webkit2gtk|gtk/gtk|GtkApplication|G_APPLICATION' '${CMAKE_CURRENT_SOURCE_DIR}/../DrakonSite/src/react-app'")

set(CPACK_PACKAGE_NAME "perceptrum-desktop")
set(CPACK_PACKAGE_VENDOR "Perceptrum")
set(CPACK_PACKAGE_CONTACT "Perceptrum")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Perceptrum Linux desktop host and headless runtime")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_FILE_NAME "perceptrum-desktop_${PROJECT_VERSION}_${CMAKE_SYSTEM_PROCESSOR}")
set(CPACK_PACKAGE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
set(CPACK_PACKAGING_INSTALL_PREFIX "${PERCEPTRUM_LINUX_PACKAGE_PREFIX}")
set(CPACK_GENERATOR "TGZ")
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    list(APPEND CPACK_GENERATOR "DEB")
    set(CPACK_DEBIAN_PACKAGE_MAINTAINER "Perceptrum")
    set(CPACK_DEBIAN_PACKAGE_SECTION "utils")
    set(PERCEPTRUM_DEBIAN_PACKAGE_DEPENDS
        "libcurl4, ffmpeg, nodejs, xdg-utils, libsecret-tools, dbus-user-session")
    if(PERCEPTRUM_ENABLE_WEBKITGTK)
        string(APPEND PERCEPTRUM_DEBIAN_PACKAGE_DEPENDS ", libgtk-3-0, libwebkit2gtk-4.1-0")
    endif()
    set(CPACK_DEBIAN_PACKAGE_DEPENDS "${PERCEPTRUM_DEBIAN_PACKAGE_DEPENDS}")
    set(CPACK_DEBIAN_PACKAGE_RECOMMENDS "gnome-keyring | kwalletmanager")
endif()
include(CPack)
