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
    namespace = "com.didi.dimina.demo"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.didi.dimina.demo"
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
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(project(":dimina"))

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
// 白名单: 仅打包进 assets 的小程序 appId(取自 gradle.properties 的 includeJsApps, 逗号分隔); 留空=全部复制
val includedJsApps = (project.findProperty("includeJsApps") as? String)
    ?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() }
    ?: emptyList()
tasks.register<Copy>("copySharedJsappToAssets") {
    // Delete all files except .gitkeep before copying
    doFirst {
        val targetDir = file("${rootProject.projectDir}/app/src/main/assets/jsapp")
        if (targetDir.exists()) {
            targetDir.listFiles()?.forEach { file ->
                if (file.name != ".gitkeep") {
                    if (file.isDirectory) file.deleteRecursively() else file.delete()
                }
            }
        }
    }

    from("${rootProject.projectDir}/../shared/jsapp")
    into("${rootProject.projectDir}/app/src/main/assets/jsapp")
    includeEmptyDirs = false
    // 白名单模式: 仅复制列表中的 appId 目录; 为空则复制全部
    if (includedJsApps.isNotEmpty()) {
        includedJsApps.forEach { appId -> include(appId, "$appId/**") }
    }
}

// Make the preBuild task depend on the copy tasks
tasks.named("preBuild") {
    dependsOn("copySharedJsappToAssets")
}
