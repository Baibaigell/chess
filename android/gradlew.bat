@rem
@rem Gradle 启动脚本（Windows）
@rem
@rem 本文件与 gradle/wrapper/gradle-wrapper.properties 配合工作。
@rem 首次运行会下载 Gradle 发行包，之后从缓存启动。
@rem
@rem 注意：本工程未包含 gradle-wrapper.jar（二进制，需由 Gradle 自身生成）。
@rem 首次使用请按 BUILD.md 第一节执行一次 `gradle wrapper` 生成它，
@rem 或直接用已安装的 gradle 命令构建（见 BUILD.md 第二节的备选方案）。
@rem

@if "%DEBUG%"=="" @echo off
setlocal

set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%

set CLASSPATH=%APP_HOME%\gradle\wrapper\gradle-wrapper.jar

if exist "%JAVA_HOME%\bin\java.exe" goto findJavaFromJavaHome
set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if "%ERRORLEVEL%"=="0" goto execute
echo ERROR: JAVA_HOME is not set and no 'java' command could be found.
exit /b 1

:findJavaFromJavaHome
set JAVA_EXE=%JAVA_HOME%\bin\java.exe
if exist "%JAVA_EXE%" goto execute
echo ERROR: JAVA_HOME is set to an invalid directory: %JAVA_HOME%
exit /b 1

:execute
"%JAVA_EXE%" %DEFAULT_JVM_OPTS% %JAVA_OPTS% %GRADLE_OPTS% ^
  "-Dorg.gradle.appname=%APP_BASE_NAME%" ^
  -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*

:end
endlocal
