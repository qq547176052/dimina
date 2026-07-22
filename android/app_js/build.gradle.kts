plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

android {
    namespace = "cn.hk.jsauto.jsapp"
    compileSdk = 35

    defaultConfig {
        applicationId = "cn.hk.jsauto.jsapp"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Only include ARM architectures
        ndk {
            abiFilters.add("arm64-v8a")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging {
        resources {
            // HiveMQ 传递依赖 Netty, 排除其 META-INF 资源避免合并冲突
            excludes += "/META-INF/INDEX.LIST"
            excludes += "/META-INF/*.kotlin_module"
            excludes += "/META-INF/*.version"
            excludes += "/META-INF/*.properties"
            excludes += "/META-INF/LICENSE*"
            excludes += "/META-INF/NOTICE*"
            excludes += "/META-INF/DEPENDENCIES"
            excludes += "/META-INF/ASL2.0"
        }
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(project(":dimina"))
    implementation(project(":push"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.compose.material.icons.core)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)
    debugImplementation(libs.androidx.ui.tooling)
    debugImplementation(libs.androidx.ui.test.manifest)
}

// Add task to copy shared jsapp files to Android app's assets folder
tasks.register<Copy>("copySharedJsappToAssets") {
    // Delete all files except .gitkeep before copying
    doFirst {
        val targetDir = file("${rootProject.projectDir}/app_js/src/main/assets/jsapp")
        if (targetDir.exists()) {
            targetDir.listFiles()?.forEach { file ->
                if (file.name != ".gitkeep") {
                    if (file.isDirectory) file.deleteRecursively() else file.delete()
                }
            }
        }
    }

    from("${rootProject.projectDir}/../shared/jsapp")
    into("${rootProject.projectDir}/app_js/src/main/assets/jsapp")
    includeEmptyDirs = false
}

// Make the preBuild task depend on the copy tasks
tasks.named("preBuild") {
    dependsOn("copySharedJsappToAssets")
}
