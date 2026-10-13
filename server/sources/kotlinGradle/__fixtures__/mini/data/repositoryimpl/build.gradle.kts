plugins {
    id("usapo.primitive.kmp")
}

kotlin {
    iosArm64 {
        binaries.framework {
            export(projects.domain.model)
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(project(":domain:usecase"))
            implementation(projects.core)
            // api(projects.domain.model)
        }
    }
}
