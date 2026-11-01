// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

val appVersion = providers.fileContents(rootProject.layout.projectDirectory.file("../frontend/package.json"))
    .asText
    .map { (JsonSlurper().parseText(it) as Map<*, *>)["version"] as String }
    .get()

val releaseSigning: Map<String, String> = run {
    val properties = Properties()
    providers.fileContents(rootProject.layout.projectDirectory.file("keystore.properties"))
        .asText.orNull?.let { properties.load(it.reader()) }

    mapOf(
        "storeFile" to "CAIMACK_KEYSTORE_FILE",
        "storePassword" to "CAIMACK_KEYSTORE_PASSWORD",
        "keyAlias" to "CAIMACK_KEY_ALIAS",
        "keyPassword" to "CAIMACK_KEY_PASSWORD",
    ).mapNotNull { (key, variable) ->
        (properties.getProperty(key) ?: providers.environmentVariable(variable).orNull)?.let { key to it }
    }.toMap()
}

android {
    namespace = "app.caimack"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.caimack"
        minSdk = 33
        targetSdk = 37
        versionName = appVersion
        versionCode = appVersion.split('.').map(String::toInt).fold(0) { code, part -> code * 100 + part }
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    signingConfigs {
        if (releaseSigning.size == 4) {
            create("release") {
                storeFile = rootProject.file(releaseSigning.getValue("storeFile"))
                storePassword = releaseSigning.getValue("storePassword")
                keyAlias = releaseSigning.getValue("keyAlias")
                keyPassword = releaseSigning.getValue("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    bundle {
        language {
            enableSplit = false
        }
    }

    lint {
        disable += "ChromeOsAbiSupport"
    }
}

tasks.matching { it.name == "packageRelease" || it.name == "packageReleaseBundle" }.configureEach {
    val missing = listOf("storeFile", "storePassword", "keyAlias", "keyPassword") - releaseSigning.keys
    doFirst {
        if (missing.isNotEmpty()) {
            throw GradleException(
                "Release signing is not configured (missing: ${missing.joinToString()}). " +
                    "Fill android/keystore.properties or set the CAIMACK_* variables, see README."
            )
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.exoplayer.hls)
    implementation(libs.media3.session)
    implementation(libs.media3.datasource.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.espresso.core)
    androidTestImplementation(libs.okhttp.mockwebserver)
    debugImplementation(libs.compose.ui.test.manifest)
}
