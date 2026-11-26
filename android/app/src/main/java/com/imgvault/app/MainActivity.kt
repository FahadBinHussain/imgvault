package com.imgvault.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.imgvault.app.ui.gallery.DetailScreen
import com.imgvault.app.ui.gallery.GalleryScreen
import com.imgvault.app.ui.settings.SettingsScreen
import com.imgvault.app.ui.theme.ImgVaultTheme
import com.imgvault.app.ui.update.UpdateScreen
import com.imgvault.app.ui.vault.VaultScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ImgVaultTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    AppRoot()
                }
            }
        }
    }
}

/** the app's routes */
object Routes {
    const val GALLERY = "gallery"
    const val VAULT = "vault"
    const val SETTINGS = "settings"
    const val UPDATE = "update"
    const val DETAIL = "detail/{itemId}"

    fun detail(itemId: String) = "detail/$itemId"
}

@Composable
fun AppRoot() {
    val navController = rememberNavController()

    NavHost(navController = navController, startDestination = Routes.GALLERY) {
        composable(Routes.GALLERY) {
            GalleryScreen(
                onOpenVault = { navController.navigate(Routes.VAULT) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) },
                onOpenUpdate = { navController.navigate(Routes.UPDATE) },
                onOpenItem = { item -> navController.navigate(Routes.detail(item.id)) },
            )
        }
        composable(Routes.VAULT) {
            VaultScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.UPDATE) {
            UpdateScreen(onBack = { navController.popBackStack() })
        }
        composable(
            route = Routes.DETAIL,
            arguments = listOf(navArgument("itemId") { type = NavType.StringType }),
        ) { entry ->
            val itemId = entry.arguments?.getString("itemId").orEmpty()
            DetailScreen(
                itemId = itemId,
                onBack = { navController.popBackStack() },
            )
        }
    }
}
